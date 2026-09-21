//! Provider credentials, kept on the Rust side only.
//!
//! The webview never sees a key. It refers to one as `tyco-secret:<id>`, and
//! the network proxy in `services::net` substitutes the value while sending the
//! request. Each secret is bound to the origins it may be sent to: without
//! that binding any script in the webview could send the reference to a host
//! of its choosing and have the proxy fill the real key in for it.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::errors::AppError;

pub const SECRETS_FILE_NAME: &str = "secrets.json";
pub const SECRET_REF_PREFIX: &str = "tyco-secret:";

const MAX_ID_LEN: usize = 64;

/// Where the well-known providers live. A secret stored under one of these
/// ids is bound to these origins unless the caller names others.
const BUILTIN_ORIGINS: &[(&str, &[&str])] = &[
    ("google", &["https://generativelanguage.googleapis.com"]),
    ("google-translate", &["https://translation.googleapis.com"]),
    ("openrouter", &["https://openrouter.ai"]),
    ("deepseek", &["https://api.deepseek.com"]),
    ("openai", &["https://api.openai.com"]),
    ("anthropic", &["https://api.anthropic.com"]),
    ("groq", &["https://api.groq.com"]),
    ("deepgram", &["https://api.deepgram.com"]),
    (
        "assemblyai",
        &[
            "https://api.assemblyai.com",
            "https://streaming.assemblyai.com",
        ],
    ),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretEntry {
    pub value: String,
    /// Normalized `scheme://host[:port]`, WebSocket schemes folded into HTTP.
    pub origins: Vec<String>,
}

/// What the webview may know about a secret: that it exists, and where it goes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub origins: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SecretsFile {
    #[serde(default)]
    secrets: BTreeMap<String, SecretEntry>,
}

pub type Secrets = BTreeMap<String, SecretEntry>;

pub struct SecretStore {
    path: Option<PathBuf>,
    entries: Mutex<Secrets>,
}

impl SecretStore {
    pub fn load_for_app(app: &AppHandle) -> Result<Self, AppError> {
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|error| AppError::Message(error.to_string()))?;
        fs::create_dir_all(&dir)?;
        Self::load(dir.join(SECRETS_FILE_NAME))
    }

    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let file = if path.exists() {
            serde_json::from_str::<SecretsFile>(&fs::read_to_string(&path)?)?
        } else {
            SecretsFile::default()
        };

        Ok(Self {
            path: Some(path),
            entries: Mutex::new(file.secrets),
        })
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        Self {
            path: None,
            entries: Mutex::new(Secrets::new()),
        }
    }

    pub fn status(&self) -> BTreeMap<String, SecretStatus> {
        self.lock()
            .iter()
            .map(|(id, entry)| {
                (
                    id.clone(),
                    SecretStatus {
                        origins: entry.origins.clone(),
                    },
                )
            })
            .collect()
    }

    /// Stores a secret. Origins default to the provider's own for a built-in
    /// id and are required for any other.
    pub fn set(&self, id: &str, value: &str, origins: Option<Vec<String>>) -> Result<(), AppError> {
        validate_id(id)?;
        let value = value.trim();
        if value.is_empty() {
            return Err(AppError::Message(format!("Secret \"{id}\" is empty")));
        }

        let origins = match origins {
            Some(origins) if !origins.is_empty() => origins
                .iter()
                .map(|origin| normalize_origin(origin))
                .collect::<Result<Vec<_>, _>>()?,
            _ => builtin_origins(id).ok_or_else(|| {
                AppError::Message(format!(
                    "Secret \"{id}\" is not a known provider; name the origins it may be sent to"
                ))
            })?,
        };

        let mut entries = self.lock();
        entries.insert(
            id.to_string(),
            SecretEntry {
                value: value.to_string(),
                origins: dedup(origins),
            },
        );
        self.persist(&entries)
    }

    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let mut entries = self.lock();
        if entries.remove(id).is_some() {
            self.persist(&entries)?;
        }
        Ok(())
    }

    /// A copy for one request, so the lock is not held across network I/O.
    pub fn snapshot(&self) -> Secrets {
        self.lock().clone()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Secrets> {
        self.entries.lock().expect("secrets lock poisoned")
    }

    fn persist(&self, entries: &Secrets) -> Result<(), AppError> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let raw = serde_json::to_string_pretty(&SecretsFile {
            secrets: entries.clone(),
        })?;
        write_private(path, &raw)
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
        Err(AppError::Message(format!("Invalid secret id \"{id}\"")))
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
        .map_err(|error| AppError::Message(format!("Invalid origin \"{origin}\": {error}")))?;
    origin_of(&url).ok_or_else(|| {
        AppError::Message(format!(
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

/// Writes through a temporary file readable by the owner only, then renames
/// it over the target.
fn write_private(path: &Path, raw: &str) -> Result<(), AppError> {
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp_path = path.with_file_name(tmp_name);

    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    {
        use std::io::Write;
        let mut file = options.open(&tmp_path)?;
        file.write_all(raw.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&tmp_path, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_id_gets_provider_origins() {
        let store = SecretStore::in_memory();
        store.set("google", " key ", None).unwrap();

        let snapshot = store.snapshot();
        let entry = snapshot.get("google").unwrap();
        assert_eq!(entry.value, "key");
        assert_eq!(
            entry.origins,
            vec!["https://generativelanguage.googleapis.com"]
        );
    }

    #[test]
    fn custom_id_requires_origins() {
        let store = SecretStore::in_memory();
        assert!(store.set("openai-compatible", "key", None).is_err());

        store
            .set(
                "openai-compatible",
                "key",
                Some(vec!["http://localhost:11434/v1/".into()]),
            )
            .unwrap();
        assert_eq!(
            store.status().get("openai-compatible").unwrap().origins,
            vec!["http://localhost:11434"]
        );
    }

    #[test]
    fn websocket_origins_fold_into_http() {
        assert_eq!(
            normalize_origin("wss://api.deepgram.com/v1/listen").unwrap(),
            "https://api.deepgram.com"
        );
        assert!(normalize_origin("file:///etc/passwd").is_err());
    }

    #[test]
    fn rejects_bad_ids_and_empty_values() {
        let store = SecretStore::in_memory();
        assert!(store.set("Google", "key", None).is_err());
        assert!(store.set("", "key", None).is_err());
        assert!(store.set("google", "   ", None).is_err());
    }

    #[test]
    fn status_never_carries_values() {
        let store = SecretStore::in_memory();
        store.set("deepseek", "sk-secret", None).unwrap();
        let raw = serde_json::to_string(&store.status()).unwrap();
        assert!(!raw.contains("sk-secret"));
    }

    #[test]
    fn persists_and_reloads() {
        let dir = std::env::temp_dir().join(format!("tyco-secrets-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(SECRETS_FILE_NAME);
        let _ = fs::remove_file(&path);

        let store = SecretStore::load(path.clone()).unwrap();
        store.set("openrouter", "or-key", None).unwrap();
        store.set("deepseek", "ds-key", None).unwrap();
        store.remove("deepseek").unwrap();

        let reloaded = SecretStore::load(path.clone()).unwrap();
        let snapshot = reloaded.snapshot();
        assert_eq!(snapshot.get("openrouter").unwrap().value, "or-key");
        assert!(!snapshot.contains_key("deepseek"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        fs::remove_dir_all(&dir).unwrap();
    }
}
