use std::fs;
use std::io::Write;
use tauri::AppHandle;

use crate::errors::AppError;
use crate::models::{WhisperModelFileMetadata, WhisperModelMetadata};
use crate::services::storage::{app_cache_dir, app_whisper_models_dir};

const METADATA_FILE_NAME: &str = "metadata.json";
const ALLOWED_WHISPER_FILES: &[&str] = &[
    "config.json",
    "generation_config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "onnx/encoder_model_quantized.onnx",
    "onnx/decoder_model_merged_quantized.onnx",
];

#[tauri::command]
pub fn is_whisper_model_downloaded(app: AppHandle, model_name: String) -> Result<bool, AppError> {
    let Some(metadata) = read_whisper_model_metadata(&app, &model_name)? else {
        return Ok(false);
    };

    Ok(metadata.complete && verify_metadata_files(&metadata, &model_dir(&app, &model_name)?)?)
}

#[tauri::command]
pub fn save_whisper_model_file(
    app: AppHandle,
    model_name: String,
    file_name: String,
    data: Vec<u8>,
) -> Result<(), AppError> {
    save_whisper_model_file_bytes(&app, &model_name, &file_name, &data, false)
}

#[tauri::command]
pub fn save_whisper_model_file_chunk(
    app: AppHandle,
    model_name: String,
    file_name: String,
    data: Vec<u8>,
    append: bool,
) -> Result<(), AppError> {
    save_whisper_model_file_bytes(&app, &model_name, &file_name, &data, append)
}

fn save_whisper_model_file_bytes(
    app: &AppHandle,
    model_name: &str,
    file_name: &str,
    data: &[u8],
    append: bool,
) -> Result<(), AppError> {
    let file_path = model_dir(app, model_name)?.join(sanitize_whisper_file_name(file_name)?);

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!append)
        .append(append)
        .open(&file_path)?;
    file.write_all(data)?;

    Ok(())
}

#[tauri::command]
pub fn delete_whisper_model(app: AppHandle, model_name: String) -> Result<(), AppError> {
    let model_dir = model_dir(&app, &model_name)?;

    if model_dir.exists() {
        fs::remove_dir_all(model_dir)?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_whisper_model_path(
    app: AppHandle,
    model_name: String,
    file_name: String,
) -> Result<String, AppError> {
    let file_path = if model_name.is_empty() && file_name.is_empty() {
        app_whisper_models_dir(&app)?
    } else {
        model_dir(&app, &model_name)?.join(sanitize_whisper_file_name(&file_name)?)
    };

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_whisper_model_file_size(
    app: AppHandle,
    model_name: String,
    file_name: String,
) -> Result<Option<u64>, AppError> {
    let path = model_dir(&app, &model_name)?.join(sanitize_whisper_file_name(&file_name)?);

    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(Some(metadata.len())),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
pub fn complete_whisper_model_download(
    app: AppHandle,
    model_name: String,
    version: String,
    files: Vec<String>,
) -> Result<WhisperModelMetadata, AppError> {
    let dir = model_dir(&app, &model_name)?;
    let mut file_metadata = Vec::new();

    for file_name in files {
        let safe_file_name = sanitize_whisper_file_name(&file_name)?;
        let path = dir.join(safe_file_name);
        let metadata = fs::metadata(&path)?;

        if !metadata.is_file() || metadata.len() == 0 {
            return Err(AppError::Message(format!(
                "Whisper model file is missing or empty: {file_name}"
            )));
        }

        file_metadata.push(WhisperModelFileMetadata {
            path: file_name,
            size_bytes: metadata.len(),
        });
    }

    let model_metadata = WhisperModelMetadata {
        model_name,
        version,
        downloaded_at: unix_timestamp_string(),
        complete: true,
        files: file_metadata,
    };
    let raw = serde_json::to_string_pretty(&model_metadata)?;
    fs::write(dir.join(METADATA_FILE_NAME), raw)?;

    Ok(model_metadata)
}

#[tauri::command]
pub fn get_whisper_model_metadata(
    app: AppHandle,
    model_name: String,
) -> Result<Option<WhisperModelMetadata>, AppError> {
    read_whisper_model_metadata(&app, &model_name)
}

fn model_dir(app: &AppHandle, model_name: &str) -> Result<std::path::PathBuf, AppError> {
    let dir_name = sanitize_model_dir_name(model_name)?;
    let dir = app_whisper_models_dir(app)?.join(&dir_name);
    let legacy_dir = app_cache_dir(app)?
        .join("models")
        .join("whisper")
        .join(&dir_name);

    if !dir.exists() && legacy_dir.exists() {
        migrate_legacy_model_dir(&legacy_dir, &dir)?;
    }

    Ok(dir)
}

fn sanitize_model_dir_name(model_name: &str) -> Result<String, AppError> {
    if model_name.is_empty() {
        return Err(AppError::Message(String::from(
            "Invalid Whisper model name",
        )));
    }

    let dir_name = model_name.replace('/', "_");
    let is_safe = dir_name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.');

    if !is_safe || dir_name.contains("..") {
        return Err(AppError::Message(String::from(
            "Invalid Whisper model name",
        )));
    }

    Ok(dir_name)
}

fn sanitize_whisper_file_name(file_name: &str) -> Result<&str, AppError> {
    if ALLOWED_WHISPER_FILES.contains(&file_name) {
        return Ok(file_name);
    }

    Err(AppError::Message(String::from(
        "Invalid Whisper model file",
    )))
}

fn read_whisper_model_metadata(
    app: &AppHandle,
    model_name: &str,
) -> Result<Option<WhisperModelMetadata>, AppError> {
    let path = model_dir(app, model_name)?.join(METADATA_FILE_NAME);

    if !path.exists() {
        return infer_legacy_metadata(app, model_name);
    }

    let raw = fs::read_to_string(path)?;
    let metadata = serde_json::from_str(&raw)?;
    Ok(Some(metadata))
}

fn infer_legacy_metadata(
    app: &AppHandle,
    model_name: &str,
) -> Result<Option<WhisperModelMetadata>, AppError> {
    let dir = model_dir(app, model_name)?;
    let mut files = Vec::new();

    for file_name in ALLOWED_WHISPER_FILES {
        let path = dir.join(file_name);
        let Ok(metadata) = fs::metadata(path) else {
            return Ok(None);
        };

        if !metadata.is_file() || metadata.len() == 0 {
            return Ok(None);
        }

        files.push(WhisperModelFileMetadata {
            path: (*file_name).to_string(),
            size_bytes: metadata.len(),
        });
    }

    let metadata = WhisperModelMetadata {
        model_name: model_name.to_string(),
        version: String::from("legacy"),
        downloaded_at: unix_timestamp_string(),
        complete: true,
        files,
    };
    fs::write(
        dir.join(METADATA_FILE_NAME),
        serde_json::to_string_pretty(&metadata)?,
    )?;

    Ok(Some(metadata))
}

fn migrate_legacy_model_dir(
    legacy_dir: &std::path::Path,
    dir: &std::path::Path,
) -> Result<(), AppError> {
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent)?;
    }

    if fs::rename(legacy_dir, dir).is_ok() {
        return Ok(());
    }

    copy_dir_all(legacy_dir, dir)?;
    fs::remove_dir_all(legacy_dir)?;
    Ok(())
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), AppError> {
    fs::create_dir_all(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target_path)?;
        } else {
            fs::copy(entry.path(), target_path)?;
        }
    }

    Ok(())
}

fn verify_metadata_files(
    metadata: &WhisperModelMetadata,
    dir: &std::path::Path,
) -> Result<bool, AppError> {
    if metadata.files.is_empty() {
        return Ok(false);
    }

    for file in &metadata.files {
        let safe_file_name = sanitize_whisper_file_name(&file.path)?;
        let path = dir.join(safe_file_name);
        let Ok(file_metadata) = fs::metadata(path) else {
            return Ok(false);
        };

        if !file_metadata.is_file() || file_metadata.len() != file.size_bytes {
            return Ok(false);
        }
    }

    Ok(true)
}

fn unix_timestamp_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_whisper_model_dir_name() {
        assert_eq!(
            sanitize_model_dir_name("openai/whisper-tiny").unwrap(),
            "openai_whisper-tiny"
        );
        assert!(sanitize_model_dir_name("").is_err());
        assert!(sanitize_model_dir_name("invalid/../path").is_err());
        assert!(sanitize_model_dir_name("invalid;name").is_err());
    }

    #[test]
    fn test_sanitize_whisper_file_name() {
        assert_eq!(
            sanitize_whisper_file_name("config.json").unwrap(),
            "config.json"
        );
        assert_eq!(
            sanitize_whisper_file_name("onnx/encoder_model_quantized.onnx").unwrap(),
            "onnx/encoder_model_quantized.onnx"
        );
        assert!(sanitize_whisper_file_name("malicious.sh").is_err());
        assert!(sanitize_whisper_file_name("../secret.txt").is_err());
    }
}
