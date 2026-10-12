//! Normalized chat images. Drafts stay in bounded session memory; only history
//! saves write bytes to disk. Session copies survive history deletion.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::atomic_file::write_private_bytes;
use crate::errors::AppError;
use crate::models::{ChatHistoryItem, ChatImage};

/// The lossless PNG the webview hands over before it becomes a WebP.
pub const MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;
/// A stored image; the strictest provider (Anthropic) accepts 5 MB per image.
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
/// Images saved before WebP were PNGs of up to 20 MB.
const MAX_STORED_BYTES: usize = 20 * 1024 * 1024;
const MAX_SESSION_BYTES: usize = 128 * 1024 * 1024;
/// The webview scales images down to this; providers reject larger ones.
const MAX_DIMENSION: u32 = 8_000;
const MAX_PIXELS: u64 = 24_000_000;
/// Mirrors `MAX_CHAT_IMAGES` in `apps/desktop-ui/src/lib/chat/chat-image-input.ts`.
const MAX_MESSAGE_IMAGES: usize = 4;
/// Lower qualities are tried only while the image exceeds `MAX_IMAGE_BYTES`.
const WEBP_QUALITIES: [f32; 4] = [85.0, 75.0, 60.0, 45.0];
const FORMATS: [(&str, &str); 2] = [("webp", "image/webp"), ("png", "image/png")];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatFileErrorKind {
    Size,
    Memory,
    Invalid,
}

/// Reaches the webview as `{ kind, message }`, so the UI never parses messages.
#[derive(Debug, Serialize, thiserror::Error)]
#[error("{message}")]
pub struct ChatFileError {
    pub kind: ChatFileErrorKind,
    pub message: String,
}

impl ChatFileError {
    pub fn new(kind: ChatFileErrorKind, message: &str) -> Self {
        Self {
            kind,
            message: message.to_string(),
        }
    }
}

impl From<ChatFileError> for AppError {
    fn from(error: ChatFileError) -> Self {
        AppError::Message(error.message)
    }
}

fn invalid(message: &str) -> ChatFileError {
    ChatFileError::new(ChatFileErrorKind::Invalid, message)
}

pub fn validate_id(id: &str) -> Result<(), AppError> {
    if id.len() != 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AppError::Message("Invalid image id".into()));
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

/// Decode the webview's PNG and encode the pixels as a WebP, never carrying
/// source metadata onto disk.
fn normalize(bytes: &[u8], name: Option<String>) -> Result<(ChatImage, Vec<u8>), ChatFileError> {
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES {
        return Err(ChatFileError::new(
            ChatFileErrorKind::Size,
            "Image size limit exceeded",
        ));
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: 128 * 1024 * 1024,
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| invalid("Invalid PNG image"))?;
    let info = reader.info();
    if !within_limits(info.width, info.height)
        || info.animation_control.is_some()
        || info.bit_depth != png::BitDepth::Eight
        || !matches!(info.color_type, png::ColorType::Rgb | png::ColorType::Rgba)
    {
        return Err(invalid("Unsupported image dimensions or format"));
    }
    let mut pixels = vec![0; reader.output_buffer_size()];
    let output = reader
        .next_frame(&mut pixels)
        .map_err(|_| invalid("Invalid PNG pixels"))?;
    let pixels = &pixels[..output.buffer_size()];
    let encoder = if output.color_type == png::ColorType::Rgba {
        webp::Encoder::from_rgba(pixels, output.width, output.height)
    } else {
        webp::Encoder::from_rgb(pixels, output.width, output.height)
    };
    for quality in WEBP_QUALITIES {
        let encoded = encoder
            .encode_simple(false, quality)
            .map_err(|_| invalid("WebP encoding failed"))?;
        if encoded.len() > MAX_IMAGE_BYTES {
            continue;
        }
        let image = ChatImage {
            id: format!("{:x}", Sha256::digest(&*encoded)),
            media_type: "image/webp".into(),
            width: output.width,
            height: output.height,
            size: encoded.len(),
            name: name.map(|name| name.chars().take(255).collect()),
        };
        return Ok((image, encoded.to_vec()));
    }
    Err(ChatFileError::new(
        ChatFileErrorKind::Size,
        "Image size limit exceeded",
    ))
}

/// Dimensions from the header: stored bytes are already normalized and are
/// verified by their hash, so they are never re-encoded.
fn stored_dimensions(bytes: &[u8], media_type: &str) -> Result<(u32, u32), ChatFileError> {
    let (width, height) = if media_type == "image/webp" {
        let features =
            webp::BitstreamFeatures::new(bytes).ok_or_else(|| invalid("Invalid WebP image"))?;
        if features.has_animation() {
            return Err(invalid("Animated images are not supported"));
        }
        (features.width(), features.height())
    } else {
        let reader = png::Decoder::new(Cursor::new(bytes))
            .read_info()
            .map_err(|_| invalid("Invalid PNG image"))?;
        (reader.info().width, reader.info().height)
    };
    // Images saved before WebP could be up to 16384 pixels wide.
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(invalid("Unsupported image dimensions"));
    }
    Ok((width, height))
}

fn stored_file(directory: &Path, id: &str) -> Option<(PathBuf, &'static str)> {
    FORMATS.iter().find_map(|(extension, media_type)| {
        let path = directory.join(format!("{id}.{extension}"));
        path.is_file().then_some((path, *media_type))
    })
}

#[derive(Default)]
pub struct ChatImageStore {
    images: HashMap<String, (ChatImage, Vec<u8>)>,
    size: usize,
    owners: HashMap<String, HashSet<String>>,
    expires: HashMap<String, std::time::Instant>,
}

impl ChatImageStore {
    fn expire_owners(&mut self) {
        let now = std::time::Instant::now();
        self.expires.retain(|owner, deadline| {
            if *deadline > now {
                true
            } else {
                self.owners.remove(owner);
                false
            }
        });
    }

    /// Normalizes an image without touching the store, so that the slow
    /// encoding does not hold its lock; [`Self::remember`] keeps the result.
    pub fn prepare(
        bytes: &[u8],
        name: Option<String>,
    ) -> Result<(ChatImage, Vec<u8>), ChatFileError> {
        normalize(bytes, name)
    }

    pub fn remember(&mut self, image: ChatImage, bytes: Vec<u8>) -> Result<(), ChatFileError> {
        self.expire_owners();
        if self.images.contains_key(&image.id) {
            return Ok(());
        }
        if self.size + bytes.len() > MAX_SESSION_BYTES {
            let held: HashSet<_> = self.owners.values().flatten().cloned().collect();
            self.images.retain(|id, (_, cached)| {
                if held.contains(id) {
                    true
                } else {
                    self.size -= cached.len();
                    false
                }
            });
        }
        if self.size + bytes.len() > MAX_SESSION_BYTES {
            return Err(ChatFileError::new(
                ChatFileErrorKind::Memory,
                "Chat image session memory limit exceeded",
            ));
        }
        self.size += bytes.len();
        self.images.insert(image.id.clone(), (image, bytes));
        Ok(())
    }

    /// Window ownership keeps active drafts alive even when saved history is removed.
    pub fn hold(&mut self, owner: &str, id: &str) {
        self.owners
            .entry(owner.to_string())
            .or_default()
            .insert(id.to_string());
    }

    pub fn hold_undo(&mut self, owner: &str, id: &str) {
        self.hold(owner, id);
        // UI releases its eight-second undo explicitly; abandoned webviews cannot pin forever.
        self.expires.insert(
            owner.to_string(),
            std::time::Instant::now() + std::time::Duration::from_secs(30),
        );
    }

    pub fn sync(&mut self, owner: &str, ids: &[String]) -> Result<(), AppError> {
        self.expire_owners();
        for id in ids {
            validate_id(id)?;
        }
        self.owners
            .insert(owner.to_string(), ids.iter().cloned().collect());
        let held: HashSet<_> = self.owners.values().flatten().cloned().collect();
        self.images.retain(|id, (_, bytes)| {
            if held.contains(id) {
                true
            } else {
                self.size -= bytes.len();
                false
            }
        });
        Ok(())
    }

    pub fn release_owner(&mut self, owner: &str) {
        self.expires
            .retain(|key, _| key != owner && !key.starts_with(&format!("{owner}/")));
        self.owners
            .retain(|key, _| key != owner && !key.starts_with(&format!("{owner}/")));
        let _ = self.sync(owner, &[]);
        self.owners.remove(owner);
    }

    #[cfg(test)]
    pub fn insert(
        &mut self,
        bytes: &[u8],
        name: Option<String>,
    ) -> Result<ChatImage, ChatFileError> {
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
        if bytes.len() > MAX_STORED_BYTES || format!("{:x}", Sha256::digest(&bytes)) != id {
            return Err(AppError::Message("Corrupted chat image".into()));
        }
        let (width, height) = stored_dimensions(&bytes, media_type)?;
        let image = ChatImage {
            id: id.to_string(),
            media_type: media_type.into(),
            width,
            height,
            size: bytes.len(),
            name: None,
        };
        self.remember(image, bytes.clone())?;
        Ok(bytes)
    }

    pub fn persist(&mut self, directory: &Path, chat: &ChatHistoryItem) -> Result<(), AppError> {
        for message in &chat.messages {
            if message.images.len() > MAX_MESSAGE_IMAGES
                || (!message.images.is_empty() && message.role != "user")
            {
                return Err(AppError::Message("Unsupported chat image message".into()));
            }
            for image in &message.images {
                let bytes = self.get(directory, &image.id)?;
                let canonical = &self.images[&image.id].0;
                if canonical.width != image.width
                    || canonical.height != image.height
                    || canonical.size != image.size
                    || canonical.media_type != image.media_type
                {
                    return Err(AppError::Message("Invalid chat image metadata".into()));
                }
                let extension = extension(&canonical.media_type)
                    .ok_or_else(|| AppError::Message("Unsupported chat image type".into()))?;
                fs::create_dir_all(directory)?;
                let path = directory.join(format!("{}.{extension}", image.id));
                if !path.exists() {
                    write_private_bytes(&path, &bytes)?;
                }
            }
        }
        Ok(())
    }
}

/// Scan surviving chats rather than duplicating references in the index.
/// An unreadable chat aborts collection: uncertain references are kept.
pub fn collect_orphans(chats_dir: &Path) -> Result<(), AppError> {
    let mut live = HashSet::new();
    for entry in fs::read_dir(chats_dir)? {
        let path = entry?.path();
        if path.extension().is_some_and(|ext| ext == "json")
            && path.file_name().is_some_and(|name| name != "index.json")
        {
            let chat: ChatHistoryItem = match serde_json::from_slice(&fs::read(&path)?) {
                Ok(chat) => chat,
                Err(_) => return Ok(()),
            };
            live.extend(
                chat.messages
                    .into_iter()
                    .flat_map(|message| message.images)
                    .map(|image| image.id),
            );
        }
    }
    let directory = chats_dir.join("images");
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| FORMATS.iter().any(|(known, _)| *known == ext))
            && path
                .file_stem()
                .and_then(|id| id.to_str())
                .is_some_and(|id| !live.contains(id))
        {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
            image.size
        );
    }

    #[test]
    fn releases_drafts_and_preserves_other_windows_and_imports() {
        let mut store = ChatImageStore::default();
        let image = store.insert(&png(), None).unwrap();
        store.hold("main/import/lease", &image.id);
        store.sync("main", &[]).unwrap();
        assert_eq!(store.size, image.size);
        store.sync("main", std::slice::from_ref(&image.id)).unwrap();
        store.release_owner("main/import/lease");
        store.hold("quick", &image.id);
        store.release_owner("main");
        assert_eq!(store.size, image.size);
        store.release_owner("quick");
        assert_eq!(store.size, 0);
        assert!(store.images.is_empty());
    }

    #[test]
    fn undo_survives_window_sync_and_expires_without_releasing_active_images() {
        let mut store = ChatImageStore::default();
        let image = store.insert(&png(), None).unwrap();
        store.hold_undo("main/undo/chat", &image.id);
        store.sync("main", &[]).unwrap();
        assert!(store.images.contains_key(&image.id));
        store.expires.insert(
            "main/undo/chat".into(),
            std::time::Instant::now() - std::time::Duration::from_secs(1),
        );
        store.hold("quick", &image.id);
        store.sync("main", &[]).unwrap();
        assert!(!store.owners.contains_key("main/undo/chat"));
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
        store.size = MAX_SESSION_BYTES;
        store.remember(image.clone(), bytes).unwrap();
        assert_eq!(store.size, image.size);
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
                .kind,
            ChatFileErrorKind::Size
        );
        assert!(validate_id("../secret").is_err());
    }

    #[test]
    fn disk_roundtrip_gc_and_session_survival() {
        let directory =
            std::env::temp_dir().join(format!("tyco-chat-images-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let mut store = ChatImageStore::default();
        let image = store.insert(&png(), None).unwrap();
        let chat = ChatHistoryItem {
            id: "test".into(),
            description: "Image".into(),
            last_msg_date: String::new(),
            messages: vec![crate::models::ChatMessage {
                role: "user".into(),
                content: String::new(),
                attachments: vec![],
                images: vec![image.clone()],
                status: None,
            }],
        };
        store.persist(&directory.join("images"), &chat).unwrap();
        fs::write(
            directory.join("test.json"),
            serde_json::to_vec(&chat).unwrap(),
        )
        .unwrap();
        collect_orphans(&directory).unwrap();
        let mut restored = ChatImageStore::default();
        assert_eq!(
            restored.get(&directory.join("images"), &image.id).unwrap(),
            store.get(&directory.join("images"), &image.id).unwrap()
        );
        fs::remove_file(directory.join("test.json")).unwrap();
        collect_orphans(&directory).unwrap();
        assert!(!directory
            .join("images")
            .join(format!("{}.webp", image.id))
            .exists());
        assert!(store.get(&directory.join("images"), &image.id).is_ok());
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn rejects_mismatched_metadata_and_exhausted_session_memory() {
        let mut store = ChatImageStore::default();
        let mut image = store.insert(&png(), None).unwrap();
        image.width = 2;
        let chat = ChatHistoryItem {
            id: "test".into(),
            description: String::new(),
            last_msg_date: String::new(),
            messages: vec![crate::models::ChatMessage {
                role: "user".into(),
                content: String::new(),
                attachments: vec![],
                images: vec![image],
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
            size: MAX_SESSION_BYTES,
            owners: HashMap::from([("window".into(), HashSet::from(["held".into()]))]),
            expires: HashMap::new(),
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
        assert_eq!(image.media_type, "image/webp");
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

    #[test]
    fn reads_legacy_png_files_without_re_encoding_them() {
        let directory =
            std::env::temp_dir().join(format!("tyco-chat-legacy-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let bytes = png();
        let id = format!("{:x}", Sha256::digest(&bytes));
        fs::write(directory.join(format!("{id}.png")), &bytes).unwrap();
        let mut store = ChatImageStore::default();
        assert_eq!(store.get(&directory, &id).unwrap(), bytes);
        assert_eq!(store.images[&id].0.media_type, "image/png");
        fs::write(directory.join(format!("{id}.png")), b"tampered").unwrap();
        assert!(ChatImageStore::default().get(&directory, &id).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
