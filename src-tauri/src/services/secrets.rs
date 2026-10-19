//! Provider credentials, kept on the Rust side only.
//!
//! The webview never sees a key. It refers to one as `tyco-secret:<id>`, and
//! the network proxy in `services::net` substitutes the value while sending the
//! request. Each secret is bound to the origins it may be sent to: without
//! that binding any script in the webview could send the reference to a host
//! of its choosing and have the proxy fill the real key in for it.
//!
//! The values live in the system credential store only; without one no key
//! can be saved. `secrets.json` lists the secrets and their origins only.

pub mod detector;
mod origins;
#[cfg(test)]
mod tests;
pub mod webhook;

pub use origins::{is_id_char, normalize_origin, origin_of};

use self::origins::{checked_secret, vault_namespace};

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::services::app_paths::{dev_paths_from_env, AppPaths};
use crate::services::atomic_file::{create_private_dir, read_or_quarantine};

pub const SECRETS_FILE_NAME: &str = "secrets.json";
pub const SECRET_REF_PREFIX: &str = "tyco-secret:";

/// Looked up to learn whether the vault can be reached at all. Not a valid
/// secret id, so it never names a real secret.
const PROBE_ID: &str = "-probe";

/// The vault could not be reached or refused the operation, e.g. because
/// the user dismissed its unlock prompt.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct VaultError(pub String);

impl From<String> for VaultError {
    fn from(message: String) -> Self {
        Self(message)
    }
}

/// A store for secret values, keyed by the secret id.
pub trait SecretVault: Send + Sync {
    /// `Ok(None)` when there is no such secret, `Err` when the vault itself
    /// cannot be reached.
    fn get(&self, id: &str) -> Result<Option<String>, VaultError>;
    fn set(&self, id: &str, value: &str) -> Result<(), VaultError>;
    /// Removing a secret that is not there succeeds.
    fn delete(&self, id: &str) -> Result<(), VaultError>;
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
    #[serde(rename = "available")]
    pub is_available: bool,
}

/// A secret as `secrets.json` keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StoredSecret {
    origins: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SecretsFile {
    #[serde(default)]
    secrets: BTreeMap<String, StoredSecret>,
}

pub type Secrets = BTreeMap<String, SecretEntry>;

#[derive(Default)]
pub(super) struct StoreState {
    stored: BTreeMap<String, StoredSecret>,
    /// The values read from the vault.
    vault_values: BTreeMap<String, String>,
    /// `None` until the vault has been asked: reaching it may show a system
    /// prompt, so that waits until a secret is needed.
    vault: Option<VaultState>,
}

impl StoreState {
    fn value(&self, id: &str) -> Option<&String> {
        self.stored.get(id)?;
        self.vault_values.get(id)
    }
}

/// The calls that reach the vault block, possibly on an unlock prompt: run
/// them through [`with_store`], never on the main thread.
pub struct SecretStore {
    pub(super) path: Option<PathBuf>,
    pub(super) vault: Option<Box<dyn SecretVault>>,
    pub(super) state: Mutex<StoreState>,
}

/// Runs `task` on a blocking thread, so that waiting for the vault holds
/// neither the main thread nor an async worker.
pub async fn with_store<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce(&SecretStore) -> T + Send + 'static,
) -> Result<T, AppError> {
    let services = app.state::<super::background::BackgroundServices>();
    let handle = app.clone();
    services
        .run_blocking(move || task(&handle.state::<SecretStore>()))
        .await
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
                        is_available: state.value(id).is_some(),
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
        let previous = state
            .stored
            .insert(id.to_string(), StoredSecret { origins });
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

    /// Removes a secret from the vault and from the file. Fails when the
    /// vault holds the value and cannot be reached: dropping the secret from
    /// the list alone would leave the key behind unseen.
    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let mut state = self.lock();
        if !state.stored.contains_key(id) {
            return Ok(());
        }

        if let Some(vault) = &self.vault {
            vault.delete(id).map_err(|error| {
                AppError::Message(format!("Could not remove secret \"{id}\": {error}"))
            })?;
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

    /// Reaches the vault and reads the values it holds. Asked once, or again with `retry`; a request does
    /// not retry, as a missing vault may take a D-Bus timeout to answer.
    fn open_locked(&self, state: &mut StoreState, retry: bool) -> VaultState {
        // a retry opens the vault again also when it answered before: a key
        // may have stayed locked, e.g. when the user dismissed the unlock
        // prompt
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

        read_missing(vault, state);
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
        .keys()
        .filter(|id| !state.vault_values.contains_key(*id))
        .cloned()
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
