//! Normalized chat images. Drafts stay in bounded session memory; only history
//! saves write bytes to disk. Session copies survive history deletion.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::Path;

use sha2::{Digest, Sha256};

use super::atomic_file::write_private_bytes;
use crate::errors::AppError;
use crate::models::{ChatHistoryItem, ChatImage};

pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_SESSION_BYTES: usize = 128 * 1024 * 1024;
const MAX_DIMENSION: u32 = 1568;

fn invalid(message: &str) -> AppError {
    AppError::Message(message.to_string())
}

pub fn validate_id(id: &str) -> Result<(), AppError> {
    if id.len() != 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid("Invalid image id"));
    }
    Ok(())
}

/// Decode and re-encode pixels, never carrying source metadata onto disk.
fn normalize(bytes: &[u8], name: Option<String>) -> Result<(ChatImage, Vec<u8>), AppError> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(invalid("Image size limit exceeded"));
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: 32 * 1024 * 1024,
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| invalid("Invalid PNG image"))?;
    let info = reader.info();
    if info.width == 0
        || info.height == 0
        || info.width > MAX_DIMENSION
        || info.height > MAX_DIMENSION
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
    let mut normalized = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut normalized, output.width, output.height);
        encoder.set_color(output.color_type);
        encoder.set_depth(output.bit_depth);
        let mut writer = encoder
            .write_header()
            .map_err(|_| invalid("PNG encoding failed"))?;
        writer
            .write_image_data(&pixels[..output.buffer_size()])
            .map_err(|_| invalid("PNG encoding failed"))?;
    }
    if normalized.len() > MAX_IMAGE_BYTES {
        return Err(invalid("Image size limit exceeded"));
    }
    let image = ChatImage {
        id: format!("{:x}", Sha256::digest(&normalized)),
        media_type: "image/png".into(),
        width: output.width,
        height: output.height,
        size: normalized.len(),
        name: name.map(|name| name.chars().take(255).collect()),
    };
    Ok((image, normalized))
}

#[derive(Default)]
pub struct ChatImageStore {
    images: HashMap<String, (ChatImage, Vec<u8>)>,
    size: usize,
}

impl ChatImageStore {
    fn remember(&mut self, image: ChatImage, bytes: Vec<u8>) -> Result<(), AppError> {
        if self.images.contains_key(&image.id) {
            return Ok(());
        }
        if self.size + bytes.len() > MAX_SESSION_BYTES {
            return Err(invalid("Chat image session memory limit exceeded"));
        }
        self.size += bytes.len();
        self.images.insert(image.id.clone(), (image, bytes));
        Ok(())
    }

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
        let mut bytes = Vec::new();
        fs::File::open(directory.join(format!("{id}.png")))?
            .take((MAX_IMAGE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_IMAGE_BYTES || format!("{:x}", Sha256::digest(&bytes)) != id {
            return Err(invalid("Corrupted chat image"));
        }
        let (image, normalized) = normalize(&bytes, None)?;
        if image.id != id {
            return Err(invalid("Noncanonical chat image"));
        }
        self.remember(image, normalized)?;
        Ok(bytes)
    }

    pub fn persist(&mut self, directory: &Path, chat: &ChatHistoryItem) -> Result<(), AppError> {
        for message in &chat.messages {
            if message.images.len() > 4 || (!message.images.is_empty() && message.role != "user") {
                return Err(invalid("Unsupported chat image message"));
            }
            for image in &message.images {
                let bytes = self.get(directory, &image.id)?;
                let canonical = &self.images[&image.id].0;
                if canonical.width != image.width
                    || canonical.height != image.height
                    || canonical.size != image.size
                    || canonical.media_type != image.media_type
                {
                    return Err(invalid("Invalid chat image metadata"));
                }
                fs::create_dir_all(directory)?;
                let path = directory.join(format!("{}.png", image.id));
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
            && path.extension().is_some_and(|ext| ext == "png")
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
    fn rejects_invalid_input_and_paths() {
        assert!(normalize(b"not a PNG", None).is_err());
        assert!(normalize(&vec![0; MAX_IMAGE_BYTES + 1], None).is_err());
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
            .join(format!("{}.png", image.id))
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
            size: MAX_SESSION_BYTES,
            ..Default::default()
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
        let (_, clean) = normalize(&bytes, None).unwrap();
        let info = png::Decoder::new(Cursor::new(&clean)).read_info().unwrap();
        assert!(info.info().uncompressed_latin1_text.is_empty());
        let mut oversized = Vec::new();
        {
            let encoder = png::Encoder::new(&mut oversized, MAX_DIMENSION + 1, 1);
            let _ = encoder.write_header().unwrap();
        }
        assert!(normalize(&oversized, None).is_err());
    }
}
