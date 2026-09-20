use std::fs;
use std::io::Write;
use tauri::AppHandle;

use crate::errors::AppError;
use crate::models::{LlmModelFileMetadata, LlmModelMetadata};
use crate::services::storage::app_llm_models_dir;

const METADATA_FILE_NAME: &str = "metadata.json";

const QWEN25_FILES: &[&str] = &[
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "merges.txt",
    "vocab.json",
    "added_tokens.json",
    "quantize_config.json",
    "onnx/model_q4.onnx",
];

const SMOLLM2_360M_FILES: &[&str] = &[
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "merges.txt",
    "vocab.json",
    "onnx/model_q4.onnx",
];

const QWEN2_FILES: &[&str] = &[
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "merges.txt",
    "vocab.json",
    "added_tokens.json",
    "quantize_config.json",
    "onnx/model_q4.onnx",
];

#[tauri::command]
pub fn is_llm_model_downloaded(app: AppHandle, model_name: String) -> Result<bool, AppError> {
    let Some(metadata) = read_llm_model_metadata(&app, &model_name)? else {
        return Ok(false);
    };

    Ok(metadata.complete && verify_metadata_files(&metadata, &model_dir(&app, &model_name)?)?)
}

#[tauri::command]
pub fn save_llm_model_file(
    app: AppHandle,
    model_name: String,
    file_name: String,
    data: Vec<u8>,
) -> Result<(), AppError> {
    save_llm_model_file_bytes(&app, &model_name, &file_name, &data, false)
}

#[tauri::command]
pub fn save_llm_model_file_chunk(
    app: AppHandle,
    model_name: String,
    file_name: String,
    data: Vec<u8>,
    append: bool,
) -> Result<(), AppError> {
    save_llm_model_file_bytes(&app, &model_name, &file_name, &data, append)
}

fn save_llm_model_file_bytes(
    app: &AppHandle,
    model_name: &str,
    file_name: &str,
    data: &[u8],
    append: bool,
) -> Result<(), AppError> {
    let file_path =
        model_dir(app, model_name)?.join(sanitize_llm_file_name(model_name, file_name)?);

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
pub fn delete_llm_model(app: AppHandle, model_name: String) -> Result<(), AppError> {
    let dir = model_dir(&app, &model_name)?;

    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_llm_model_path(
    app: AppHandle,
    model_name: String,
    file_name: String,
) -> Result<String, AppError> {
    let file_path = if model_name.is_empty() && file_name.is_empty() {
        app_llm_models_dir(&app)?
    } else {
        model_dir(&app, &model_name)?.join(sanitize_llm_file_name(&model_name, &file_name)?)
    };

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_llm_model_file_size(
    app: AppHandle,
    model_name: String,
    file_name: String,
) -> Result<Option<u64>, AppError> {
    let path = model_dir(&app, &model_name)?.join(sanitize_llm_file_name(&model_name, &file_name)?);

    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(Some(metadata.len())),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
pub fn complete_llm_model_download(
    app: AppHandle,
    model_name: String,
    version: String,
    files: Vec<String>,
) -> Result<LlmModelMetadata, AppError> {
    let dir = model_dir(&app, &model_name)?;
    let mut file_metadata = Vec::new();

    for file_name in files {
        let safe_file_name = sanitize_llm_file_name(&model_name, &file_name)?;
        let path = dir.join(safe_file_name);
        let metadata = fs::metadata(&path)?;

        if !metadata.is_file() || metadata.len() == 0 {
            return Err(AppError::Message(format!(
                "LLM model file is missing or empty: {file_name}"
            )));
        }

        file_metadata.push(LlmModelFileMetadata {
            path: file_name,
            size_bytes: metadata.len(),
        });
    }

    let model_metadata = LlmModelMetadata {
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
pub fn get_llm_model_metadata(
    app: AppHandle,
    model_name: String,
) -> Result<Option<LlmModelMetadata>, AppError> {
    read_llm_model_metadata(&app, &model_name)
}

fn model_dir(app: &AppHandle, model_name: &str) -> Result<std::path::PathBuf, AppError> {
    Ok(app_llm_models_dir(app)?.join(sanitize_model_dir_name(model_name)?))
}

fn sanitize_model_dir_name(model_name: &str) -> Result<String, AppError> {
    if model_name.is_empty() {
        return Err(AppError::Message(String::from("Invalid LLM model name")));
    }

    let dir_name = model_name.replace('/', "_");
    let is_safe = dir_name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.');

    if !is_safe || dir_name.contains("..") {
        return Err(AppError::Message(String::from("Invalid LLM model name")));
    }

    Ok(dir_name)
}

fn sanitize_llm_file_name<'a>(model_name: &str, file_name: &'a str) -> Result<&'a str, AppError> {
    if allowed_files(model_name).contains(&file_name) {
        return Ok(file_name);
    }

    Err(AppError::Message(String::from("Invalid LLM model file")))
}

fn allowed_files(model_name: &str) -> &'static [&'static str] {
    match model_name {
        "onnx-community/Qwen2.5-0.5B-Instruct" => QWEN25_FILES,
        "HuggingFaceTB/SmolLM2-360M-Instruct" => SMOLLM2_360M_FILES,
        "onnx-community/Qwen2-0.5B-Instruct-ONNX" => QWEN2_FILES,
        _ => &[],
    }
}

fn read_llm_model_metadata(
    app: &AppHandle,
    model_name: &str,
) -> Result<Option<LlmModelMetadata>, AppError> {
    let path = model_dir(app, model_name)?.join(METADATA_FILE_NAME);

    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)?;
    let metadata = serde_json::from_str(&raw)?;
    Ok(Some(metadata))
}

fn verify_metadata_files(
    metadata: &LlmModelMetadata,
    dir: &std::path::Path,
) -> Result<bool, AppError> {
    if metadata.files.is_empty() {
        return Ok(false);
    }

    for file in &metadata.files {
        let safe_file_name = sanitize_llm_file_name(&metadata.model_name, &file.path)?;
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
    fn test_sanitize_model_dir_name() {
        assert_eq!(
            sanitize_model_dir_name("onnx-community/Qwen2.5-0.5B-Instruct").unwrap(),
            "onnx-community_Qwen2.5-0.5B-Instruct"
        );
        assert!(sanitize_model_dir_name("").is_err());
        assert!(sanitize_model_dir_name("invalid/../path").is_err());
        assert!(sanitize_model_dir_name("invalid;name").is_err());
    }

    #[test]
    fn test_sanitize_llm_file_name() {
        let model = "onnx-community/Qwen2.5-0.5B-Instruct";
        assert_eq!(
            sanitize_llm_file_name(model, "config.json").unwrap(),
            "config.json"
        );
        assert_eq!(
            sanitize_llm_file_name(model, "onnx/model_q4.onnx").unwrap(),
            "onnx/model_q4.onnx"
        );
        assert!(sanitize_llm_file_name(model, "malicious.exe").is_err());
        assert!(sanitize_llm_file_name("unknown-model", "config.json").is_err());
    }
}
