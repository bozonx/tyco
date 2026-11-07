//! The files of conversations: normalized images and the originals of
//! attached files. Drafts stay in bounded session memory; only history saves
//! write bytes to disk. Session copies survive history deletion. Ownership and
//! lifetime: `dev_docs/chat-files.md`.
use crate::locks::MutexExt;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use crate::services::sha256::sha256_hex;

use super::atomic_file::write_private_bytes;
use crate::errors::AppError;
use crate::models::{Chat, ChatAttachmentFile, ChatImage};

/// The folder of the attachment originals inside a chat folder.
pub const ATTACHMENTS_DIR: &str = "attachments";
/// The folder of the images inside a chat folder.
pub const IMAGES_DIR: &str = "images";
pub use crate::desktop_contract::MAX_CHAT_FILE_BYTES as MAX_FILE_BYTES;

/// The lossless PNG the webview hands over before it becomes a WebP.
pub use crate::desktop_contract::MAX_CHAT_IMAGE_SOURCE_BYTES as MAX_SOURCE_BYTES;
/// A stored image; the strictest provider (Anthropic) accepts 5 MB per image.
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
/// Images saved before WebP were PNGs of up to 20 MB.
const MAX_STORED_BYTES: usize = 20 * 1024 * 1024;
const MAX_SESSION_BYTES: usize = 128 * 1024 * 1024;
/// Memory the PNG decoder may use for one image.
const MAX_DECODER_BYTES: usize = 128 * 1024 * 1024;
use crate::desktop_contract::MAX_CHAT_IMAGES_COUNT as MAX_MESSAGE_IMAGES;
/// The webview scales images down to this; providers reject larger ones.
use crate::desktop_contract::MAX_CHAT_IMAGE_DIMENSION as MAX_DIMENSION;
use crate::desktop_contract::MAX_CHAT_IMAGE_PIXELS as MAX_PIXELS;
/// Lower qualities are tried only while the image exceeds `MAX_IMAGE_BYTES`.
const WEBP_QUALITIES: [f32; 4] = [85.0, 75.0, 60.0, 45.0];
const FORMATS: [(&str, &str); 1] = [("webp", "image/webp")];

pub fn validate_id(id: &str) -> Result<(), AppError> {
    if id.len() != 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AppError::InvalidInput("Invalid image id".into()));
    }
    Ok(())
}

fn extension(media_type: &str) -> Option<&'static str> {
    FORMATS
        .iter()
        .find(|(_, known)| *known == media_type)
        .map(|(extension, _)| *extension)
}

fn within_limits(width: u32, height: u32) -> bool {
    width > 0
        && height > 0
        && width <= MAX_DIMENSION
        && height <= MAX_DIMENSION
        && u64::from(width) * u64::from(height) <= MAX_PIXELS
}

/// Bounds for raw captured pixels before they are reduced to the image limits.
pub const MAX_CAPTURE_DIMENSION: u32 = 16_384;
pub const MAX_CAPTURE_PIXELS: u64 = 48_000_000;

pub fn within_capture_limits(width: u32, height: u32) -> bool {
    width > 0
        && height > 0
        && width <= MAX_CAPTURE_DIMENSION
        && height <= MAX_CAPTURE_DIMENSION
        && u64::from(width) * u64::from(height) <= MAX_CAPTURE_PIXELS
}

/// The size a capture is encoded at: kept as is unless exceeding the maximum
/// dimension or pixel count limit.
fn capture_size(width: u32, height: u32) -> (u32, u32) {
    let longest = f64::from(width.max(height));
    let area = f64::from(width) * f64::from(height);
    let scale = (f64::from(MAX_DIMENSION) / longest)
        .min((MAX_PIXELS as f64 / area).sqrt())
        .min(1.0);
    if scale >= 1.0 {
        return (width, height);
    }
    let fit = |side: u32| ((f64::from(side) * scale).floor() as u32).max(1);
    (fit(width), fit(height))
}

/// Averages every source pixel an output pixel covers. Unlike sampling a few
/// neighbours, this keeps thin text strokes when HiDPI screens shrink 2-4x.
fn downscale(pixels: &[u8], width: u32, height: u32, out_width: u32, out_height: u32) -> Vec<u8> {
    let (width, height) = (width as usize, height as usize);
    let (out_width, out_height) = (out_width as usize, out_height as usize);
    let span = |index: usize, out: usize, source: usize| {
        let start = index * source / out;
        let end = ((index + 1) * source / out).max(start + 1);
        start..end
    };
    let mut resized = vec![0; out_width * out_height * 4];
    for out_y in 0..out_height {
        let rows = span(out_y, out_height, height);
        for out_x in 0..out_width {
            let columns = span(out_x, out_width, width);
            let mut sum = [0u32; 4];
            for y in rows.clone() {
                let row = &pixels[(y * width + columns.start) * 4..(y * width + columns.end) * 4];
                for pixel in row.as_chunks::<4>().0 {
                    for (total, value) in sum.iter_mut().zip(pixel) {
                        *total += u32::from(*value);
                    }
                }
            }
            let count = (rows.len() * columns.len()) as u32;
            let target = &mut resized[(out_y * out_width + out_x) * 4..][..4];
            for (value, total) in target.iter_mut().zip(sum) {
                *value = ((total + count / 2) / count) as u8;
            }
        }
    }
    resized
}

/// Decode the webview's PNG and encode the pixels as a WebP, never carrying
/// source metadata onto disk.
fn normalize(bytes: &[u8], name: Option<String>) -> Result<(ChatImage, Vec<u8>), AppError> {
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES {
        return Err(AppError::FileTooLarge("Image size limit exceeded".into()));
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: MAX_DECODER_BYTES,
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| AppError::invalid_input("Invalid PNG image"))?;
    let info = reader.info();
    if !within_limits(info.width, info.height)
        || info.animation_control.is_some()
        || info.bit_depth != png::BitDepth::Eight
        || !matches!(info.color_type, png::ColorType::Rgb | png::ColorType::Rgba)
    {
        return Err(AppError::invalid_input(
            "Unsupported image dimensions or format",
        ));
    }
    let buffer_size = reader
        .output_buffer_size()
        .ok_or_else(|| AppError::invalid_input("Unsupported image dimensions or format"))?;
    let mut pixels = vec![0; buffer_size];
    let output = reader
        .next_frame(&mut pixels)
        .map_err(|_| AppError::invalid_input("Invalid PNG pixels"))?;
    let pixels = &pixels[..output.buffer_size()];
    encode_pixels(
        pixels,
        output.width,
        output.height,
        output.color_type == png::ColorType::Rgba,
        name,
    )
}

fn encode_pixels(
    pixels: &[u8],
    width: u32,
    height: u32,
    rgba: bool,
    name: Option<String>,
) -> Result<(ChatImage, Vec<u8>), AppError> {
    let encoder = if rgba {
        webp::Encoder::from_rgba(pixels, width, height)
    } else {
        webp::Encoder::from_rgb(pixels, width, height)
    };
    if let Ok(encoded) = encoder.encode_simple(true, 75.0) {
        if encoded.len() <= MAX_IMAGE_BYTES {
            let image = ChatImage {
                id: sha256_hex(&*encoded),
                media_type: crate::models::ChatImageMediaType::Webp,
                width_px: width,
                height_px: height,
                size_bytes: encoded.len(),
                name: name.map(|name| name.chars().take(255).collect()),
            };
            return Ok((image, encoded.to_vec()));
        }
    }
    for quality in WEBP_QUALITIES {
        let encoded = encoder
            .encode_simple(false, quality)
            .map_err(|_| AppError::invalid_input("WebP encoding failed"))?;
        if encoded.len() > MAX_IMAGE_BYTES {
            continue;
        }
        let image = ChatImage {
            id: sha256_hex(&*encoded),
            media_type: crate::models::ChatImageMediaType::Webp,
            width_px: width,
            height_px: height,
            size_bytes: encoded.len(),
            name: name.map(|name| name.chars().take(255).collect()),
        };
        return Ok((image, encoded.to_vec()));
    }
    Err(AppError::FileTooLarge("Image size limit exceeded".into()))
}

/// Dimensions from the header: stored bytes are already normalized and are
/// verified by their hash, so they are never re-encoded.
fn stored_dimensions(bytes: &[u8]) -> Result<(u32, u32), AppError> {
    let features = webp::BitstreamFeatures::new(bytes)
        .ok_or_else(|| AppError::invalid_input("Invalid WebP image"))?;
    if features.has_animation() {
        return Err(AppError::invalid_input("Animated images are not supported"));
    }
    let (width, height) = (features.width(), features.height());
    if !within_limits(width, height) {
        return Err(AppError::invalid_input("Unsupported image dimensions"));
    }
    Ok((width, height))
}

fn stored_file(directory: &Path, id: &str) -> Option<(PathBuf, &'static str)> {
    FORMATS.iter().find_map(|(extension, media_type)| {
        let path = directory.join(format!("{id}.{extension}"));
        path.is_file().then_some((path, *media_type))
    })
}

/// The chat images of the session, which every window shares.
#[derive(Default)]
pub struct ChatImages(std::sync::Mutex<ChatImageStore>);

impl ChatImages {
    pub fn lock(&self) -> std::sync::MutexGuard<'_, ChatImageStore> {
        self.0.locked()
    }

    /// For the history, which takes the lock only once it writes images.
    pub fn store(&self) -> &std::sync::Mutex<ChatImageStore> {
        &self.0
    }
}

#[derive(Default)]
pub struct ChatImageStore {
    images: HashMap<String, (ChatImage, Vec<u8>)>,
    /// Attachment originals, by the SHA-256 of their bytes.
    files: HashMap<String, Vec<u8>>,
    /// The bytes of images and files together.
    total_image_bytes: usize,
    image_ids_by_owner: HashMap<String, HashSet<String>>,
    owner_expiration_deadlines: HashMap<String, std::time::Instant>,
}

impl ChatImageStore {
    fn expire_owners(&mut self) {
        let now = std::time::Instant::now();
        self.owner_expiration_deadlines.retain(|owner, deadline| {
            if *deadline > now {
                true
            } else {
                self.image_ids_by_owner.remove(owner);
                false
            }
        });
    }

    /// Normalizes an image without touching the store, so that the slow
    /// encoding does not hold its lock; [`Self::remember`] keeps the result.
    pub fn prepare(bytes: &[u8], name: Option<String>) -> Result<(ChatImage, Vec<u8>), AppError> {
        normalize(bytes, name)
    }

    /// Native captures share the encoder without an intermediate PNG. A capture
    /// may exceed the image limits, e.g. a portal shot of several monitors; it
    /// is reduced to fit them instead of being rejected.
    pub fn prepare_capture(
        pixels: &[u8],
        width: u32,
        height: u32,
    ) -> Result<(ChatImage, Vec<u8>), AppError> {
        if !within_capture_limits(width, height)
            || pixels.len() != width as usize * height as usize * 4
        {
            return Err(AppError::FileTooLarge(
                "Screenshot dimensions limit exceeded".into(),
            ));
        }
        let (out_width, out_height) = capture_size(width, height);
        let name = Some("Screenshot.webp".to_string());
        if (out_width, out_height) == (width, height) {
            return encode_pixels(pixels, width, height, true, name);
        }
        let resized = downscale(pixels, width, height, out_width, out_height);
        encode_pixels(&resized, out_width, out_height, true, name)
    }

    pub fn remember(&mut self, image: ChatImage, bytes: Vec<u8>) -> Result<(), AppError> {
        self.expire_owners();
        if self.images.contains_key(&image.id) {
            return Ok(());
        }
        self.make_room(bytes.len())?;
        self.total_image_bytes += bytes.len();
        self.images.insert(image.id.clone(), (image, bytes));
        Ok(())
    }

    /// Evicts what no owner holds when `len` more bytes would not fit.
    fn make_room(&mut self, len: usize) -> Result<(), AppError> {
        if self.total_image_bytes + len > MAX_SESSION_BYTES {
            self.evict_unheld();
        }
        if self.total_image_bytes + len > MAX_SESSION_BYTES {
            return Err(AppError::ResourceLimit(
                "Chat image session memory limit exceeded".into(),
            ));
        }
        Ok(())
    }

    fn evict_unheld(&mut self) {
        let held: HashSet<_> = self
            .image_ids_by_owner
            .values()
            .flatten()
            .cloned()
            .collect();
        let total = &mut self.total_image_bytes;
        self.images.retain(|id, (_, cached)| {
            let keep = held.contains(id);
            if !keep {
                *total -= cached.len();
            }
            keep
        });
        self.files.retain(|id, cached| {
            let keep = held.contains(id);
            if !keep {
                *total -= cached.len();
            }
            keep
        });
    }

    /// The reference of an attachment original, checked against the limits.
    pub fn prepare_file(bytes: &[u8]) -> Result<ChatAttachmentFile, AppError> {
        if bytes.len() > MAX_FILE_BYTES {
            return Err(AppError::FileTooLarge("File size limit exceeded".into()));
        }
        Ok(ChatAttachmentFile {
            id: sha256_hex(bytes),
            size_bytes: bytes.len(),
        })
    }

    /// Keeps the bytes of an attachment original `file` describes.
    pub fn remember_file(
        &mut self,
        file: &ChatAttachmentFile,
        bytes: Vec<u8>,
    ) -> Result<(), AppError> {
        self.expire_owners();
        if self.files.contains_key(&file.id) {
            return Ok(());
        }
        self.make_room(bytes.len())?;
        self.total_image_bytes += bytes.len();
        self.files.insert(file.id.clone(), bytes);
        Ok(())
    }

    /// The bytes of an attachment original: from the session, else from the
    /// `attachments` folder `directory`, verified by their hash.
    pub fn get_file(&mut self, directory: &Path, id: &str) -> Result<Vec<u8>, AppError> {
        validate_id(id)?;
        if let Some(bytes) = self.files.get(id) {
            return Ok(bytes.clone());
        }
        let mut bytes = Vec::new();
        fs::File::open(directory.join(id))?
            .take((MAX_FILE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_FILE_BYTES || sha256_hex(&bytes) != id {
            return Err(AppError::InvalidData("Corrupted chat file".into()));
        }
        let file = ChatAttachmentFile {
            id: id.to_string(),
            size_bytes: bytes.len(),
        };
        // an unheld read must not fail for want of session memory
        if let Err(error) = self.remember_file(&file, bytes.clone()) {
            log::debug!("Not caching chat file {id}: {error}");
        }
        Ok(bytes)
    }

    /// Writes the attachment originals `chat` refers to into the
    /// `attachments` folder `directory`.
    pub fn persist_files(&mut self, directory: &Path, chat: &Chat) -> Result<(), AppError> {
        for message in &chat.messages {
            let files = message
                .attachments
                .iter()
                .filter_map(|item| item.file.as_ref());
            for file in files {
                if message.role != crate::models::ChatRole::User {
                    return Err(AppError::InvalidInput(
                        "Unsupported chat file message".into(),
                    ));
                }
                let path = directory.join(&file.id);
                validate_id(&file.id)?;
                if path.is_file() {
                    continue;
                }
                // a file lost from the disk and the session must not keep the
                // rest of the chat from being saved
                let bytes = match self.get_file(directory, &file.id) {
                    Ok(bytes) => bytes,
                    Err(error @ (AppError::Io(_) | AppError::InvalidData(_))) => {
                        log::warn!("Saving the chat without file {}: {error}", file.id);
                        continue;
                    }
                    Err(error) => return Err(error),
                };
                if bytes.len() != file.size_bytes {
                    return Err(AppError::InvalidInput("Invalid chat file metadata".into()));
                }
                crate::services::atomic_file::create_private_dir(directory)?;
                write_private_bytes(&path, &bytes)?;
            }
        }
        Ok(())
    }

    /// Window ownership keeps active drafts alive even when saved history is removed.
    pub fn hold(&mut self, owner: &str, id: &str) {
        self.image_ids_by_owner
            .entry(owner.to_string())
            .or_default()
            .insert(id.to_string());
    }

    pub fn hold_undo(&mut self, owner: &str, id: &str) {
        self.hold(owner, id);
        // UI releases its eight-second undo explicitly; abandoned webviews cannot pin forever.
        self.owner_expiration_deadlines.insert(
            owner.to_string(),
            std::time::Instant::now() + std::time::Duration::from_secs(30),
        );
    }

    pub fn sync(&mut self, owner: &str, ids: &[String]) -> Result<(), AppError> {
        self.expire_owners();
        for id in ids {
            validate_id(id)?;
        }
        self.image_ids_by_owner
            .insert(owner.to_string(), ids.iter().cloned().collect());
        self.evict_unheld();
        Ok(())
    }

    pub fn release_owner(&mut self, owner: &str) {
        self.owner_expiration_deadlines
            .retain(|key, _| key != owner && !key.starts_with(&format!("{owner}/")));
        self.image_ids_by_owner
            .retain(|key, _| key != owner && !key.starts_with(&format!("{owner}/")));
        let _ = self.sync(owner, &[]);
        self.image_ids_by_owner.remove(owner);
    }

    #[cfg(test)]
    pub fn insert(&mut self, bytes: &[u8], name: Option<String>) -> Result<ChatImage, AppError> {
        let (image, bytes) = normalize(bytes, name)?;
        self.remember(image.clone(), bytes)?;
        Ok(image)
    }

    pub fn get(&mut self, directory: &Path, id: &str) -> Result<Vec<u8>, AppError> {
        validate_id(id)?;
        if let Some((_, bytes)) = self.images.get(id) {
            return Ok(bytes.clone());
        }
        let (path, media_type) = stored_file(directory, id)
            .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound))?;
        let mut bytes = Vec::new();
        fs::File::open(path)?
            .take((MAX_STORED_BYTES + 1) as u64)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_STORED_BYTES || sha256_hex(&bytes) != id {
            return Err(AppError::InvalidData("Corrupted chat image".into()));
        }
        let (width, height) = stored_dimensions(&bytes)?;
        let image = ChatImage {
            id: id.to_string(),
            media_type: media_type.parse()?,
            width_px: width,
            height_px: height,
            size_bytes: bytes.len(),
            name: None,
        };
        self.remember(image, bytes.clone())?;
        Ok(bytes)
    }

    pub fn persist(&mut self, directory: &Path, chat: &Chat) -> Result<(), AppError> {
        for message in &chat.messages {
            if message.images.len() > MAX_MESSAGE_IMAGES
                || (!message.images.is_empty() && message.role != crate::models::ChatRole::User)
            {
                return Err(AppError::InvalidInput(
                    "Unsupported chat image message".into(),
                ));
            }
            for image in &message.images {
                // an image lost from the disk and the session must not keep
                // the rest of the chat from being saved: it shows as one that
                // failed, as when the chat is opened
                let bytes = match self.get(directory, &image.id) {
                    Ok(bytes) => bytes,
                    Err(error @ (AppError::Io(_) | AppError::InvalidData(_))) => {
                        log::warn!("Saving the chat without image {}: {error}", image.id);
                        continue;
                    }
                    Err(error) => return Err(error),
                };
                let canonical = &self.images[&image.id].0;
                if canonical.width_px != image.width_px
                    || canonical.height_px != image.height_px
                    || canonical.size_bytes != image.size_bytes
                    || canonical.media_type != image.media_type
                {
                    return Err(AppError::InvalidInput("Invalid chat image metadata".into()));
                }
                let extension = extension(canonical.media_type.as_str())
                    .ok_or_else(|| AppError::InvalidInput("Unsupported chat image type".into()))?;
                crate::services::atomic_file::create_private_dir(directory)?;
                let path = directory.join(format!("{}.{extension}", image.id));
                if !path.exists() {
                    write_private_bytes(&path, &bytes)?;
                }
            }
        }
        Ok(())
    }
}

/// How long an image no chat refers to stays: a sync tool may bring an image
/// before the chat that refers to it.
pub const ORPHAN_IMAGE_GRACE_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// When each image without a chat referring to it was first seen, by images
/// folder and image id. The time of the file is no help: Syncthing and rsync
/// keep the time of the original.
type OrphanRecord = std::collections::BTreeMap<String, std::collections::BTreeMap<String, u64>>;

/// Removes the images and attachment originals of `chats_dir` no chat has
/// referred to for `ORPHAN_IMAGE_GRACE_MS`, by the times kept in
/// `orphans_path`. A file that is referred to again leaves the record. An
/// unreadable chat aborts collection: uncertain references are kept.
pub fn remove_orphan_images(
    chats_dir: &Path,
    orphans_path: &Path,
    now_ms: u64,
) -> Result<(), AppError> {
    crate::services::storage::user_data::ensure_write_allowed(chats_dir)?;
    let mut record: OrphanRecord = fs::read(orphans_path)
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default();
    let before = record.clone();

    let mut live_images = HashSet::new();
    let mut live_files = HashSet::new();
    let chats = crate::services::storage::user_files::list_own_files(chats_dir, |name| {
        name.strip_suffix(".json")
            .is_some_and(|id| crate::services::file_ids::is_file_id(id) && id != "index")
    })?;
    for (_, path) in chats {
        let chat: Chat = match serde_json::from_slice(&fs::read(&path)?) {
            Ok(chat) => chat,
            Err(error) => {
                log::warn!(
                    "Keeping all chat files: chat file {} is unreadable ({error})",
                    path.display()
                );
                return Ok(());
            }
        };
        for message in chat.messages {
            live_images.extend(message.images.into_iter().map(|image| image.id));
            live_files.extend(
                message
                    .attachments
                    .into_iter()
                    .filter_map(|attachment| attachment.file)
                    .map(|file| file.id),
            );
        }
    }
    let images = chats_dir.join(IMAGES_DIR);
    collect_orphans(&mut record, &images, &live_images, now_ms, |name| {
        let path = Path::new(name);
        let is_known = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| FORMATS.iter().any(|(known, _)| *known == ext));
        is_known
            .then(|| {
                path.file_stem()
                    .and_then(|id| id.to_str())
                    .map(str::to_owned)
            })
            .flatten()
    })?;
    let files = chats_dir.join(ATTACHMENTS_DIR);
    collect_orphans(&mut record, &files, &live_files, now_ms, |name| {
        validate_id(name).is_ok().then(|| name.to_owned())
    })?;
    if record != before {
        if let Some(dir) = orphans_path.parent() {
            crate::services::atomic_file::create_private_dir(dir)?;
        }
        crate::services::atomic_file::write_private(
            orphans_path,
            &serde_json::to_string(&record)?,
        )?;
    }
    Ok(())
}

/// Collects the files of `directory` whose id, read from the name by
/// `id_of`, is not in `live` and has been without a reference long enough.
fn collect_orphans(
    record: &mut OrphanRecord,
    directory: &Path,
    live: &HashSet<String>,
    now_ms: u64,
    id_of: impl Fn(&str) -> Option<String>,
) -> Result<(), AppError> {
    let key = directory.to_string_lossy().into_owned();
    let entries = crate::services::storage::user_files::list_own_files(directory, |name| {
        id_of(name).is_some()
    })?;
    let seen = record.entry(key.clone()).or_default();
    let mut present = HashSet::new();
    for (name, path) in entries {
        let Some(id) = id_of(&name) else {
            continue;
        };
        present.insert(id.clone());
        if live.contains(&id) {
            seen.remove(&id);
            continue;
        }
        let first_seen = *seen.entry(id.clone()).or_insert(now_ms);
        if now_ms.saturating_sub(first_seen) >= ORPHAN_IMAGE_GRACE_MS {
            fs::remove_file(&path)?;
            seen.remove(&id);
            present.remove(&id);
        }
    }
    seen.retain(|id, _| present.contains(id));
    if seen.is_empty() {
        record.remove(&key);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn a_capture_is_encoded_without_an_intermediate_png_and_preserves_dimensions() {
        let pixels = vec![200u8; 3200 * 1800 * 4];
        let (image, bytes) = ChatImageStore::prepare_capture(&pixels, 3200, 1800).unwrap();
        assert_eq!((image.width_px, image.height_px), (3200, 1800));
        assert_eq!(image.size_bytes, bytes.len());
        let (small, _) = ChatImageStore::prepare_capture(&pixels[..64 * 32 * 4], 64, 32).unwrap();
        assert_eq!((small.width_px, small.height_px), (64, 32));
    }

    #[test]
    fn a_capture_with_inconsistent_or_oversized_dimensions_is_rejected() {
        assert!(ChatImageStore::prepare_capture(&[0; 15], 2, 2).is_err());
        assert!(ChatImageStore::prepare_capture(&[], 0, 0).is_err());
        assert!(ChatImageStore::prepare_capture(&[], 100_000, 1).is_err());
    }

    #[test]
    fn a_capture_beyond_the_image_limits_is_reduced_to_fit_them() {
        // Three 4K monitors side by side, as a portal may return them.
        assert_eq!(capture_size(11_520, 2160), (8000, 1500));
        // A 5K monitor kept at its size would exceed the pixel limit.
        let (width, height) = capture_size(7680, 4320);
        assert!(u64::from(width) * u64::from(height) <= MAX_PIXELS);
        assert_eq!(capture_size(1920, 1080), (1920, 1080));
        assert_eq!(capture_size(800, 600), (800, 600));
    }

    #[test]
    fn downscaling_averages_thin_strokes_instead_of_dropping_them() {
        // A one-pixel black line every four columns on white.
        let (width, height) = (16u32, 4u32);
        let mut pixels = vec![255u8; (width * height * 4) as usize];
        for y in 0..height {
            for x in (0..width).step_by(4) {
                let at = ((y * width + x) * 4) as usize;
                pixels[at..at + 3].fill(0);
            }
        }
        let resized = downscale(&pixels, width, height, 4, 1);
        for pixel in resized.as_chunks::<4>().0 {
            assert_eq!(*pixel, [191, 191, 191, 255]);
        }
    }

    fn png() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[10, 20, 30, 255]).unwrap();
        }
        bytes
    }

    #[test]
    fn normalizes_deduplicates_and_keeps_drafts_off_disk() {
        let mut store = ChatImageStore::default();
        let image = store.insert(&png(), Some("sample.png".into())).unwrap();
        let other = store.insert(&png(), None).unwrap();
        assert_eq!(image.id, other.id);
        assert_eq!(store.images.len(), 1);
        assert_eq!(
            store
                .get(Path::new("/nonexistent"), &image.id)
                .unwrap()
                .len(),
            image.size_bytes
        );
    }

    #[test]
    fn releases_drafts_and_preserves_other_windows_and_imports() {
        let mut store = ChatImageStore::default();
        let image = store.insert(&png(), None).unwrap();
        store.hold("main/import/lease", &image.id);
        store.sync("main", &[]).unwrap();
        assert_eq!(store.total_image_bytes, image.size_bytes);
        store.sync("main", std::slice::from_ref(&image.id)).unwrap();
        store.release_owner("main/import/lease");
        store.hold("quick", &image.id);
        store.release_owner("main");
        assert_eq!(store.total_image_bytes, image.size_bytes);
        store.release_owner("quick");
        assert_eq!(store.total_image_bytes, 0);
        assert!(store.images.is_empty());
    }

    #[test]
    fn undo_survives_window_sync_and_expires_without_releasing_active_images() {
        let mut store = ChatImageStore::default();
        let image = store.insert(&png(), None).unwrap();
        store.hold_undo("main/undo/chat", &image.id);
        store.sync("main", &[]).unwrap();
        assert!(store.images.contains_key(&image.id));
        store.owner_expiration_deadlines.insert(
            "main/undo/chat".into(),
            std::time::Instant::now() - std::time::Duration::from_secs(1),
        );
        store.hold("quick", &image.id);
        store.sync("main", &[]).unwrap();
        assert!(!store.image_ids_by_owner.contains_key("main/undo/chat"));
        assert!(store.images.contains_key(&image.id));
        store.release_owner("quick");
        assert!(store.images.is_empty());
    }

    #[test]
    fn evicts_unowned_read_cache_but_never_active_images() {
        let mut store = ChatImageStore::default();
        let (image, bytes) = normalize(&png(), None).unwrap();
        store
            .images
            .insert("cache".into(), (image.clone(), vec![0; MAX_SESSION_BYTES]));
        store.total_image_bytes = MAX_SESSION_BYTES;
        store.remember(image.clone(), bytes).unwrap();
        assert_eq!(store.total_image_bytes, image.size_bytes);
        assert!(!store.images.contains_key("cache"));
        store.hold("main", &image.id);
        store.sync("quick", &[]).unwrap();
        assert!(store.images.contains_key(&image.id));
    }
    #[test]
    fn rejects_invalid_input_and_paths() {
        assert!(normalize(b"not a PNG", None).is_err());
        assert_eq!(
            normalize(&vec![0; MAX_SOURCE_BYTES + 1], None)
                .unwrap_err()
                .code(),
            crate::errors::ErrorCode::FileTooLarge
        );
        assert!(validate_id("../secret").is_err());
    }

    #[test]
    fn disk_roundtrip_gc_and_session_survival() {
        let directory = TestDir::new("tyco-chat-images-test");
        let mut store = ChatImageStore::default();
        let image = store.insert(&png(), None).unwrap();
        let chat = Chat {
            id: "test".into(),
            title: "Image".into(),
            last_message_at_ms: 0,
            messages: vec![crate::models::ChatMessage {
                role: crate::models::ChatRole::User,
                content: String::new(),
                attachments: vec![],
                images: vec![image.clone()],
                parts: vec![],
                status: None,
            }],
        };
        store.persist(&directory.join("images"), &chat).unwrap();
        fs::write(
            directory.join("test.json"),
            serde_json::to_vec(&chat).unwrap(),
        )
        .unwrap();
        let orphans = directory.join("state/orphan-images.json");
        remove_orphan_images(&directory, &orphans, 0).unwrap();
        let mut restored = ChatImageStore::default();
        assert_eq!(
            restored.get(&directory.join("images"), &image.id).unwrap(),
            store.get(&directory.join("images"), &image.id).unwrap()
        );
        let file = directory.join("images").join(format!("{}.webp", image.id));
        fs::remove_file(directory.join("test.json")).unwrap();
        // first seen without a chat: kept for the grace period, whatever
        // the time of the file says
        remove_orphan_images(&directory, &orphans, 1_000).unwrap();
        assert!(file.exists());
        remove_orphan_images(&directory, &orphans, ORPHAN_IMAGE_GRACE_MS).unwrap();
        assert!(file.exists());
        remove_orphan_images(&directory, &orphans, 1_000 + ORPHAN_IMAGE_GRACE_MS).unwrap();
        assert!(!file.exists());
        assert!(store.get(&directory.join("images"), &image.id).is_ok());
    }

    #[test]
    fn an_image_referred_to_again_leaves_the_record() {
        let directory = TestDir::new("tyco-chat-images-adopted");
        let images = directory.join("images");
        fs::create_dir_all(&images).unwrap();
        let id = "a".repeat(64);
        let file = images.join(format!("{id}.webp"));
        fs::write(&file, b"image").unwrap();
        let orphans = directory.join("state/orphan-images.json");
        remove_orphan_images(&directory, &orphans, 0).unwrap();
        assert!(fs::read_to_string(&orphans).unwrap().contains(&id));
        // the chat arrives
        let chat = serde_json::json!({
            "id": "late",
            "title": "Late",
            "lastMessageAt": 0,
            "messages": [{"role": "user", "content": "", "images": [{
                "id": id, "mediaType": "image/webp", "width": 1, "height": 1, "size": 5
            }]}]
        });
        fs::write(directory.join("late.json"), chat.to_string()).unwrap();
        remove_orphan_images(&directory, &orphans, 2 * ORPHAN_IMAGE_GRACE_MS).unwrap();
        assert!(file.exists());
        assert!(!orphans.exists() || !fs::read_to_string(&orphans).unwrap().contains(&id));
    }
    #[test]
    fn rejects_mismatched_metadata_and_exhausted_session_memory() {
        let mut store = ChatImageStore::default();
        let mut image = store.insert(&png(), None).unwrap();
        image.width_px = 2;
        let chat = Chat {
            id: "test".into(),
            title: String::new(),
            last_message_at_ms: 0,
            messages: vec![crate::models::ChatMessage {
                role: crate::models::ChatRole::User,
                content: String::new(),
                attachments: vec![],
                images: vec![image],
                parts: vec![],
                status: None,
            }],
        };
        assert!(store.persist(Path::new("/nonexistent"), &chat).is_err());
        let mut full = ChatImageStore {
            images: HashMap::from([(
                "held".into(),
                (
                    store.images.values().next().unwrap().0.clone(),
                    vec![0; MAX_SESSION_BYTES],
                ),
            )]),
            files: HashMap::new(),
            total_image_bytes: MAX_SESSION_BYTES,
            image_ids_by_owner: HashMap::from([("window".into(), HashSet::from(["held".into()]))]),
            owner_expiration_deadlines: HashMap::new(),
        };
        assert!(full.insert(&png(), None).is_err());
    }

    #[test]
    fn strips_text_metadata_and_rejects_oversized_dimensions() {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .add_text_chunk("Location".into(), "private-location".into())
                .unwrap();
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[10, 20, 30, 255])
                .unwrap();
        }
        let (image, clean) = normalize(&bytes, None).unwrap();
        assert_eq!(image.media_type, crate::models::ChatImageMediaType::Webp);
        assert_eq!(&clean[..4], b"RIFF");
        assert_eq!(&clean[8..12], b"WEBP");
        assert!(!clean
            .windows(b"private-location".len())
            .any(|window| window == b"private-location"));
        let mut oversized = Vec::new();
        {
            let encoder = png::Encoder::new(&mut oversized, MAX_DIMENSION + 1, 1);
            let _ = encoder.write_header().unwrap();
        }
        assert!(normalize(&oversized, None).is_err());
    }
}
