//! Provider credentials, kept on the Rust side only.
//!
//! The webview never sees a key. It refers to one as `tyco-secret:<id>`, and
//! the network proxy in `services::net` substitutes the value while sending the
//! request. Each secret is bound to the origins it may be sent to: without
//! that binding any script in the webview could send the reference to a host
//! of its choosing and have the proxy fill the real key in for it.
//!
//! The values live in the system credential store only; without one no key
//! can be saved. `secrets.json` lists the secrets and their origins. It holds
//! a value only when an older version wrote it there, or the config migration
//! took it out of the config: such a value is moved into the store as soon as
//! the store opens, and used from the file until then.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::errors::AppError;
use crate::services::app_paths::{dev_paths_from_env, AppPaths};
use crate::services::atomic_file::{create_private_dir, read_or_quarantine};

pub const SECRETS_FILE_NAME: &str = "secrets.json";
pub const SECRET_REF_PREFIX: &str = "tyco-secret:";

const MAX_ID_LEN: usize = 64;

/// Looked up to learn whether the vault can be reached at all. Not a valid
/// secret id, so it never names a real secret.
const PROBE_ID: &str = "-probe";

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

/// A store for secret values, keyed by the secret id.
pub trait SecretVault: Send + Sync {
    /// `Ok(None)` when there is no such secret, `Err` when the vault itself
    /// cannot be reached.
    fn get(&self, id: &str) -> Result<Option<String>, String>;
    fn set(&self, id: &str, value: &str) -> Result<(), String>;
    /// Removing a secret that is not there succeeds.
    fn delete(&self, id: &str) -> Result<(), String>;
}

/// Whether the system credential store can be reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VaultState {
    Available,
    /// There is no store, or it could not be reached: no key can be saved,
    /// and the stored ones cannot be read.
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretEntry {
    pub value: String,
    /// Normalized `scheme://host[:port]`, WebSocket schemes folded into HTTP.
    pub origins: Vec<String>,
}

/// What the webview may know about a secret: that it exists, where it goes,
/// and whether its value can be read now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub origins: Vec<String>,
    /// False while the vault holding the value is locked or unreachable.
    pub available: bool,
}

/// A secret as `secrets.json` keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StoredSecret {
    origins: Vec<String>,
    /// A value not moved into the vault yet: written by an older version or
    /// by the config migration. Never set for a new secret.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    value: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SecretsFile {
    #[serde(default)]
    secrets: BTreeMap<String, StoredSecret>,
}

pub type Secrets = BTreeMap<String, SecretEntry>;

#[derive(Default)]
struct StoreState {
    stored: BTreeMap<String, StoredSecret>,
    /// The values read from the vault.
    vault_values: BTreeMap<String, String>,
    /// `None` until the vault has been asked: reaching it may show a system
    /// prompt, so that waits until a secret is needed.
    vault: Option<VaultState>,
}

impl StoreState {
    fn value(&self, id: &str) -> Option<&String> {
        let stored = self.stored.get(id)?;
        stored.value.as_ref().or_else(|| self.vault_values.get(id))
    }
}

/// The calls that reach the vault block, possibly on an unlock prompt: run
/// them through [`with_store`], never on the main thread.
pub struct SecretStore {
    path: Option<PathBuf>,
    vault: Option<Box<dyn SecretVault>>,
    state: Mutex<StoreState>,
}

/// Runs `task` on a blocking thread, so that waiting for the vault holds
/// neither the main thread nor an async worker.
pub async fn with_store<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce(&SecretStore) -> T + Send + 'static,
) -> Result<T, AppError> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || task(&app.state::<SecretStore>()))
        .await
        .map_err(|error| AppError::Message(error.to_string()))
}

impl SecretStore {
    pub fn load_for_app(app: &AppHandle) -> Result<Self, AppError> {
        let dir = AppPaths::resolve(app)?.config_dir;
        create_private_dir(&dir)?;
        let namespace = vault_namespace(
            &app.config().identifier,
            dev_paths_from_env(&app.config().identifier)?
                .map(|paths| paths.config_dir)
                .as_deref(),
        );
        Self::load(dir.join(SECRETS_FILE_NAME), system_vault(namespace))
    }

    /// A file that cannot be parsed is moved aside: the app must start either
    /// way, and the user re-enters the keys.
    pub fn load(path: PathBuf, vault: Option<Box<dyn SecretVault>>) -> Result<Self, AppError> {
        #[cfg(unix)]
        if path.exists() {
            use std::os::unix::fs::PermissionsExt;
            if let Err(error) =
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            {
                log::warn!("Could not close {} to other users: {error}", path.display());
            }
        }
        let file = read_or_quarantine(&path, |raw| Ok(serde_json::from_str::<SecretsFile>(raw)?))?
            .unwrap_or_default();

        Ok(Self {
            path: Some(path),
            vault,
            state: Mutex::new(StoreState {
                stored: file.secrets,
                ..StoreState::default()
            }),
        })
    }

    /// Asks the vault again: it may have been installed or unlocked since,
    /// or a key may have stayed locked the last time.
    pub fn vault_state(&self) -> VaultState {
        let mut state = self.lock();
        self.open_locked(&mut state, true)
    }

    /// Metadata only: inspecting ownership must not unlock the vault.
    pub fn ids(&self) -> Vec<String> {
        self.lock().stored.keys().cloned().collect()
    }

    /// Which secrets exist, where each may be sent, and whether it can be
    /// used now. Never the values.
    pub fn status(&self) -> BTreeMap<String, SecretStatus> {
        let mut state = self.lock();
        self.open_locked(&mut state, false);
        state
            .stored
            .iter()
            .map(|(id, stored)| {
                (
                    id.clone(),
                    SecretStatus {
                        origins: stored.origins.clone(),
                        available: state.value(id).is_some(),
                    },
                )
            })
            .collect()
    }

    /// Stores a secret in the vault. Origins default to the provider's own
    /// for a built-in id and are required for any other. Fails when there is
    /// no vault: the value is never written to a file.
    pub fn set(&self, id: &str, value: &str, origins: Option<Vec<String>>) -> Result<(), AppError> {
        let (value, origins) = checked_secret(id, value, origins)?;

        let mut state = self.lock();
        let vault = match (self.open_locked(&mut state, true), &self.vault) {
            (VaultState::Available, Some(vault)) => vault,
            _ => return Err(vault_unavailable()),
        };

        // the list is written first: a key the vault took but the list does
        // not name would stay in the vault unseen
        let previous = state.stored.insert(
            id.to_string(),
            StoredSecret {
                origins,
                value: None,
            },
        );
        let saved = self.persist(&state).and_then(|()| {
            vault.set(id, value).map_err(|error| {
                AppError::Message(format!("Could not save secret \"{id}\": {error}"))
            })
        });
        if let Err(error) = saved {
            match previous {
                Some(previous) => state.stored.insert(id.to_string(), previous),
                None => state.stored.remove(id),
            };
            if let Err(error) = self.persist(&state) {
                log::error!("Could not restore {SECRETS_FILE_NAME}: {error}");
            }
            return Err(error);
        }
        state.vault_values.insert(id.to_string(), value.to_string());
        Ok(())
    }

    /// Keeps a key taken out of an old config in the file, without reaching
    /// the vault: the migration runs at the start, which an unlock prompt
    /// must not hold up. The config held the key in the clear until now, and
    /// the vault takes it once it opens.
    pub fn stage(
        &self,
        id: &str,
        value: &str,
        origins: Option<Vec<String>>,
    ) -> Result<(), AppError> {
        let (value, origins) = checked_secret(id, value, origins)?;

        let mut state = self.lock();
        state.vault_values.remove(id);
        state.stored.insert(
            id.to_string(),
            StoredSecret {
                origins,
                value: Some(value.to_string()),
            },
        );
        self.persist(&state)
    }

    /// Removes a secret from the vault and from the file. Fails when the
    /// vault holds the value and cannot be reached: dropping the secret from
    /// the list alone would leave the key behind unseen.
    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let mut state = self.lock();
        let Some(stored) = state.stored.get(id) else {
            return Ok(());
        };

        // a staged value may sit next to an older copy in the vault, so the
        // vault is cleared in any case
        if let Some(vault) = &self.vault {
            if let Err(error) = vault.delete(id) {
                if stored.value.is_none() {
                    return Err(AppError::Message(format!(
                        "Could not remove secret \"{id}\": {error}"
                    )));
                }
                log::warn!("Secret \"{id}\" may stay in the vault: {error}");
            }
        }

        state.stored.remove(id);
        state.vault_values.remove(id);
        self.persist(&state)
    }

    /// A copy for one request, so the lock is not held across network I/O.
    /// Holds only the secrets that have a value at hand.
    pub fn snapshot(&self) -> Secrets {
        let mut state = self.lock();
        self.open_locked(&mut state, false);
        state
            .stored
            .iter()
            .filter_map(|(id, stored)| {
                let value = state.value(id)?;
                Some((
                    id.clone(),
                    SecretEntry {
                        value: value.clone(),
                        origins: stored.origins.clone(),
                    },
                ))
            })
            .collect()
    }

    /// Reaches the vault: reads the values it holds and moves into it the
    /// ones the file holds. Asked once, or again with `retry`; a request does
    /// not retry, as a missing vault may take a D-Bus timeout to answer.
    fn open_locked(&self, state: &mut StoreState, retry: bool) -> VaultState {
        // a retry opens the vault again also when it answered before: a key
        // may have stayed locked, e.g. when the user dismissed the unlock
        // prompt, or may not have been moved into it
        if let (Some(known), false) = (state.vault, retry) {
            return known;
        }
        let Some(vault) = self
            .vault
            .as_deref()
            .filter(|vault| match vault.get(PROBE_ID) {
                Ok(_) => true,
                Err(error) => {
                    log::warn!("The system keychain is unavailable: {error}");
                    false
                }
            })
        else {
            state.vault = Some(VaultState::Unavailable);
            return VaultState::Unavailable;
        };
        state.vault = Some(VaultState::Available);

        let mut moved = false;
        for (id, stored) in state.stored.iter_mut() {
            let Some(value) = stored.value.take() else {
                continue;
            };
            match move_to_vault(vault, id, &value) {
                Ok(()) => {
                    state.vault_values.insert(id.clone(), value);
                    moved = true;
                }
                Err(error) => {
                    log::warn!("Secret \"{id}\" stays in {SECRETS_FILE_NAME}: {error}");
                    stored.value = Some(value);
                }
            }
        }
        read_missing(vault, state);
        // the values are in the vault either way, and the file is rewritten
        // on the next try
        if moved {
            if let Err(error) = self.persist(state) {
                log::error!("Could not drop the moved keys from {SECRETS_FILE_NAME}: {error}");
            }
        }
        VaultState::Available
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, StoreState> {
        self.state.lock().expect("secrets lock poisoned")
    }

    fn persist(&self, state: &StoreState) -> Result<(), AppError> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let raw = serde_json::to_string_pretty(&SecretsFile {
            secrets: state.stored.clone(),
        })?;
        crate::services::atomic_file::write_private(path, &raw)
    }
}

/// Reads from the vault the values of the secrets that have none at hand.
fn read_missing(vault: &dyn SecretVault, state: &mut StoreState) {
    let missing: Vec<String> = state
        .stored
        .iter()
        .filter(|(id, stored)| stored.value.is_none() && !state.vault_values.contains_key(*id))
        .map(|(id, _)| id.clone())
        .collect();
    for id in missing {
        match vault.get(&id) {
            Ok(Some(value)) => {
                state.vault_values.insert(id, value);
            }
            Ok(None) => log::warn!("Secret \"{id}\" is missing from the vault"),
            Err(error) => log::warn!("Secret \"{id}\" could not be read: {error}"),
        }
    }
}

fn vault_unavailable() -> AppError {
    AppError::ServiceUnavailable(String::from(
        "The system keychain is unavailable, so the key cannot be saved",
    ))
}

/// The trimmed value and the normalized origins of a secret to store.
fn checked_secret<'a>(
    id: &str,
    value: &'a str,
    origins: Option<Vec<String>>,
) -> Result<(&'a str, Vec<String>), AppError> {
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
    Ok((value, dedup(origins)))
}

/// Writes the value and reads it back: the copy in the file is dropped only
/// once the vault is known to hold it.
fn move_to_vault(vault: &dyn SecretVault, id: &str, value: &str) -> Result<(), String> {
    vault.set(id, value)?;
    match vault.get(id)? {
        Some(stored) if stored == value => Ok(()),
        _ => Err(String::from("the vault did not keep the value")),
    }
}

/// The app identifier, and for a development home a suffix of its own: the
/// system store is one per user, and a test setup must not read or delete
/// the real keys.
fn vault_namespace(identifier: &str, dev_config_dir: Option<&std::path::Path>) -> String {
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

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn system_vault(namespace: String) -> Option<Box<dyn SecretVault>> {
    Some(Box::new(
        crate::services::platform::keychain::SystemKeychain::new(namespace),
    ))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn system_vault(_namespace: String) -> Option<Box<dyn SecretVault>> {
    None
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    /// A vault in memory that can be made unreachable or read-only.
    #[derive(Default)]
    struct FakeVault {
        values: Mutex<BTreeMap<String, String>>,
        unreachable: AtomicBool,
        read_only: AtomicBool,
        /// Ids whose reads fail, like an item the user did not unlock.
        locked: Mutex<std::collections::BTreeSet<String>>,
    }

    impl SecretVault for Arc<FakeVault> {
        fn get(&self, id: &str) -> Result<Option<String>, String> {
            if self.unreachable.load(Ordering::SeqCst) {
                return Err(String::from("no vault"));
            }
            if self.locked.lock().unwrap().contains(id) {
                return Err(String::from("prompt dismissed"));
            }
            Ok(self.values.lock().unwrap().get(id).cloned())
        }

        fn set(&self, id: &str, value: &str) -> Result<(), String> {
            if self.unreachable.load(Ordering::SeqCst) || self.read_only.load(Ordering::SeqCst) {
                return Err(String::from("write refused"));
            }
            self.values
                .lock()
                .unwrap()
                .insert(id.to_string(), value.to_string());
            Ok(())
        }

        fn delete(&self, id: &str) -> Result<(), String> {
            if self.unreachable.load(Ordering::SeqCst) {
                return Err(String::from("no vault"));
            }
            self.values.lock().unwrap().remove(id);
            Ok(())
        }
    }

    impl FakeVault {
        fn value(&self, id: &str) -> Option<String> {
            self.values.lock().unwrap().get(id).cloned()
        }

        fn put(&self, id: &str, value: &str) {
            self.values
                .lock()
                .unwrap()
                .insert(id.to_string(), value.to_string());
        }
    }

    /// A store with a working vault and no file.
    fn in_memory() -> SecretStore {
        SecretStore {
            path: None,
            vault: Some(Box::new(Arc::new(FakeVault::default()))),
            state: Mutex::new(StoreState::default()),
        }
    }

    fn temp_secrets_path(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tyco-secrets-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join(SECRETS_FILE_NAME)
    }

    fn load_with(path: &std::path::Path, vault: &Arc<FakeVault>) -> SecretStore {
        SecretStore::load(path.to_path_buf(), Some(Box::new(vault.clone()))).unwrap()
    }

    #[test]
    fn a_key_left_locked_is_read_on_the_next_retry() {
        let path = temp_secrets_path("locked");
        let vault = Arc::new(FakeVault::default());
        load_with(&path, &vault).set("google", "key", None).unwrap();
        vault.locked.lock().unwrap().insert(String::from("google"));

        let store = load_with(&path, &vault);
        assert_eq!(store.vault_state(), VaultState::Available);
        assert!(!store.status()["google"].available);

        vault.locked.lock().unwrap().clear();
        assert!(
            !store.status()["google"].available,
            "a request does not retry"
        );
        store.vault_state();
        assert!(store.status()["google"].available);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn builtin_id_gets_provider_origins() {
        let store = in_memory();
        store.set("google", " key ", None).unwrap();
        store.set("deepl", " deepl-key ", None).unwrap();

        let snapshot = store.snapshot();
        let entry = snapshot.get("google").unwrap();
        assert_eq!(entry.value, "key");
        assert_eq!(
            entry.origins,
            vec!["https://generativelanguage.googleapis.com"]
        );
        assert_eq!(
            snapshot.get("deepl").unwrap().origins,
            vec!["https://api.deepl.com", "https://api-free.deepl.com"]
        );
    }

    #[test]
    fn custom_id_requires_origins() {
        let store = in_memory();
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
        let store = in_memory();
        assert!(store.set("Google", "key", None).is_err());
        assert!(store.set("", "key", None).is_err());
        assert!(store.set("google", "   ", None).is_err());
    }

    #[test]
    fn status_never_carries_values() {
        let store = in_memory();
        store.set("deepseek", "sk-secret", None).unwrap();
        let raw = serde_json::to_string(&store.status()).unwrap();
        assert!(!raw.contains("sk-secret"));
    }

    #[test]
    fn values_go_to_the_vault_and_not_to_the_file() {
        let path = temp_secrets_path("vault");
        let vault = Arc::new(FakeVault::default());

        let store = load_with(&path, &vault);
        store.set("deepseek", "ds-key", None).unwrap();

        assert_eq!(store.vault_state(), VaultState::Available);
        assert_eq!(vault.value("deepseek").as_deref(), Some("ds-key"));
        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("ds-key"));
        assert!(raw.contains("https://api.deepseek.com"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        let reloaded = load_with(&path, &vault);
        assert_eq!(reloaded.snapshot()["deepseek"].value, "ds-key");

        reloaded.remove("deepseek").unwrap();
        assert_eq!(vault.value("deepseek"), None);
        assert!(load_with(&path, &vault).status().is_empty());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn an_unreadable_file_is_moved_aside() {
        let dir = std::env::temp_dir().join(format!("tyco-secrets-broken-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(SECRETS_FILE_NAME);
        fs::write(&path, "{ not json").unwrap();

        let store = SecretStore::load(path.clone(), None).unwrap();

        assert!(store.status().is_empty());
        assert!(!path.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn without_a_vault_no_key_is_saved() {
        let path = temp_secrets_path("no-vault");
        let vault = Arc::new(FakeVault::default());
        vault.unreachable.store(true, Ordering::SeqCst);

        let store = load_with(&path, &vault);
        assert!(store.set("groq", "gq-key", None).is_err());
        assert_eq!(store.vault_state(), VaultState::Unavailable);
        assert!(store.status().is_empty());
        // the listing written before the vault refused is taken back
        assert!(load_with(&path, &vault).status().is_empty());

        // the vault is asked again, e.g. once the user has unlocked it
        vault.unreachable.store(false, Ordering::SeqCst);
        store.set("groq", "gq-key", None).unwrap();
        assert_eq!(vault.value("groq").as_deref(), Some("gq-key"));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_refused_write_is_an_error() {
        let path = temp_secrets_path("read-only");
        let vault = Arc::new(FakeVault::default());
        vault.read_only.store(true, Ordering::SeqCst);

        let store = load_with(&path, &vault);
        assert!(store.set("anthropic", "an-key", None).is_err());

        assert_eq!(store.vault_state(), VaultState::Available);
        assert!(store.status().is_empty());
        // the listing written before the vault refused is taken back
        assert!(load_with(&path, &vault).status().is_empty());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_secret_of_an_unreachable_vault_stays_listed() {
        let path = temp_secrets_path("unreachable");
        let vault = Arc::new(FakeVault::default());
        load_with(&path, &vault)
            .set("google", "g-key", None)
            .unwrap();

        vault.unreachable.store(true, Ordering::SeqCst);
        let offline = load_with(&path, &vault);
        assert_eq!(
            offline.status()["google"],
            SecretStatus {
                origins: vec![String::from("https://generativelanguage.googleapis.com")],
                available: false,
            }
        );
        assert!(offline.snapshot().is_empty());
        // removing it now would leave the key in the vault unseen
        assert!(offline.remove("google").is_err());
        assert!(offline.status().contains_key("google"));

        vault.unreachable.store(false, Ordering::SeqCst);
        assert_eq!(offline.vault_state(), VaultState::Available);
        assert!(offline.status()["google"].available);
        assert_eq!(offline.snapshot()["google"].value, "g-key");
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn values_in_the_file_move_into_the_vault() {
        let path = temp_secrets_path("move");
        fs::write(
            &path,
            r#"{"secrets":{"openai":{"value":"sk-old","origins":["https://api.openai.com"]}}}"#,
        )
        .unwrap();
        let vault = Arc::new(FakeVault::default());

        let store = load_with(&path, &vault);
        assert_eq!(store.snapshot()["openai"].value, "sk-old");

        assert_eq!(vault.value("openai").as_deref(), Some("sk-old"));
        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("sk-old"));
        assert!(raw.contains("https://api.openai.com"));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_value_in_the_file_is_used_until_the_vault_takes_it() {
        let path = temp_secrets_path("staged");
        let vault = Arc::new(FakeVault::default());
        vault.unreachable.store(true, Ordering::SeqCst);

        let store = load_with(&path, &vault);
        store
            .stage(
                "openai",
                "sk-staged",
                Some(vec!["https://api.openai.com".into()]),
            )
            .unwrap();
        assert_eq!(store.snapshot()["openai"].value, "sk-staged");
        assert!(store.status()["openai"].available);
        assert!(fs::read_to_string(&path).unwrap().contains("sk-staged"));

        vault.unreachable.store(false, Ordering::SeqCst);
        let reloaded = load_with(&path, &vault);
        assert_eq!(reloaded.vault_state(), VaultState::Available);
        assert_eq!(vault.value("openai").as_deref(), Some("sk-staged"));
        assert!(!fs::read_to_string(&path).unwrap().contains("sk-staged"));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn removing_a_value_in_the_file_clears_an_older_copy_in_the_vault() {
        let path = temp_secrets_path("stale");
        let vault = Arc::new(FakeVault::default());
        vault.put("deepl", "d-stale");

        let store = load_with(&path, &vault);
        store.stage("deepl", "d-new", None).unwrap();
        store.remove("deepl").unwrap();

        assert_eq!(vault.value("deepl"), None);
        assert!(store.status().is_empty());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_value_in_the_file_can_be_removed_without_a_vault() {
        let path = temp_secrets_path("staged-offline");
        let vault = Arc::new(FakeVault::default());
        vault.unreachable.store(true, Ordering::SeqCst);

        let store = load_with(&path, &vault);
        store.stage("groq", "gq-key", None).unwrap();
        store.remove("groq").unwrap();

        assert!(store.status().is_empty());
        assert!(!fs::read_to_string(&path).unwrap().contains("gq-key"));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_development_home_gets_its_own_namespace() {
        assert_eq!(vault_namespace("com.tyco.app", None), "com.tyco.app");
        let dev = vault_namespace(
            "com.tyco.app",
            Some(std::path::Path::new("/repo/dev_files/.config/com.tyco.app")),
        );
        assert!(dev.starts_with("com.tyco.app.dev-"));
        assert_ne!(
            dev,
            vault_namespace(
                "com.tyco.app",
                Some(std::path::Path::new("/other/.config/com.tyco.app"))
            )
        );
    }
}
