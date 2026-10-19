use sha2::{Digest, Sha256};
use url::Url;

use crate::errors::AppError;

const MAX_ID_LEN: usize = 64;

/// Where the well-known providers live. A secret stored under one of these
/// ids is bound to these origins unless the caller names others.
const BUILTIN_ORIGINS: &[(&str, &[&str])] = &[
    ("google", &["https://generativelanguage.googleapis.com"]),
    ("google-translate", &["https://translation.googleapis.com"]),
    (
        "deepl",
        &["https://api.deepl.com", "https://api-free.deepl.com"],
    ),
    ("openrouter", &["https://openrouter.ai"]),
    ("deepseek", &["https://api.deepseek.com"]),
    ("openai", &["https://api.openai.com"]),
    ("anthropic", &["https://api.anthropic.com"]),
    ("groq", &["https://api.groq.com"]),
    ("deepgram", &["https://api.deepgram.com"]),
];

/// The trimmed value and the normalized origins of a secret to store.
pub(super) fn checked_secret<'a>(
    id: &str,
    value: &'a str,
    origins: Option<Vec<String>>,
) -> Result<(&'a str, Vec<String>), AppError> {
    validate_id(id)?;
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("Secret \"{id}\" is empty")));
    }

    let origins = match origins {
        Some(origins) if !origins.is_empty() => origins
            .iter()
            .map(|origin| normalize_origin(origin))
            .collect::<Result<Vec<_>, _>>()?,
        _ => builtin_origins(id).ok_or_else(|| {
            AppError::InvalidInput(format!(
                "Secret \"{id}\" is not a known provider; name the origins it may be sent to"
            ))
        })?,
    };
    Ok((value, dedup(origins)))
}

/// Writes the value and reads it back: the copy in the file is dropped only
/// once the vault is known to hold it.
/// The app identifier, and for a development home a suffix of its own: the
/// system store is one per user, and a test setup must not read or delete
/// the real keys.
pub(super) fn vault_namespace(
    identifier: &str,
    dev_config_dir: Option<&std::path::Path>,
) -> String {
    match dev_config_dir {
        None => identifier.to_string(),
        Some(dir) => {
            let digest = Sha256::digest(dir.to_string_lossy().as_bytes());
            let suffix: String = digest[..4]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            format!("{identifier}.dev-{suffix}")
        }
    }
}

pub fn builtin_origins(id: &str) -> Option<Vec<String>> {
    BUILTIN_ORIGINS
        .iter()
        .find(|(builtin, _)| *builtin == id)
        .map(|(_, origins)| origins.iter().map(|origin| origin.to_string()).collect())
}

pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id.chars().all(is_id_char)
        && id.starts_with(|c: char| c.is_ascii_alphanumeric())
}

pub fn is_id_char(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-')
}

fn validate_id(id: &str) -> Result<(), AppError> {
    if is_valid_id(id) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "Invalid secret id \"{id}\""
        )))
    }
}

/// `scheme://host[:port]` of an HTTP or WebSocket URL, with `ws`/`wss` folded
/// into `http`/`https`: a provider's live endpoint is the same party as its
/// REST one.
pub fn origin_of(url: &Url) -> Option<String> {
    let scheme = match url.scheme() {
        "http" | "ws" => "http",
        "https" | "wss" => "https",
        _ => return None,
    };
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("{scheme}://{host}:{port}"),
        None => format!("{scheme}://{host}"),
    })
}

pub fn normalize_origin(origin: &str) -> Result<String, AppError> {
    let url = Url::parse(origin.trim())
        .map_err(|error| AppError::InvalidInput(format!("Invalid origin \"{origin}\": {error}")))?;
    origin_of(&url).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "Invalid origin \"{origin}\": expected an http(s) or ws(s) URL"
        ))
    })
}

fn dedup(origins: Vec<String>) -> Vec<String> {
    let mut result = Vec::with_capacity(origins.len());
    for origin in origins {
        if !result.contains(&origin) {
            result.push(origin);
        }
    }
    result
}
