use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::origins::vault_namespace;
use super::*;
use crate::services::test_support::TestDir;

/// A vault in memory that can be made unreachable or read-only.
#[derive(Default)]
struct FakeVault {
    values: Mutex<BTreeMap<String, String>>,
    unreachable: AtomicBool,
    read_only: AtomicBool,
    /// Ids whose reads fail, like an item the user did not unlock.
    locked: Mutex<BTreeSet<String>>,
}

impl SecretVault for Arc<FakeVault> {
    fn get(&self, id: &str) -> Result<Option<String>, VaultError> {
        if self.unreachable.load(Ordering::SeqCst) {
            return Err(VaultError(String::from("no vault")));
        }
        if self.locked.lock().unwrap().contains(id) {
            return Err(VaultError(String::from("prompt dismissed")));
        }
        Ok(self.values.lock().unwrap().get(id).cloned())
    }

    fn set(&self, id: &str, value: &str) -> Result<(), VaultError> {
        if self.unreachable.load(Ordering::SeqCst) || self.read_only.load(Ordering::SeqCst) {
            return Err(VaultError(String::from("write refused")));
        }
        self.values
            .lock()
            .unwrap()
            .insert(id.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, id: &str) -> Result<(), VaultError> {
        if self.unreachable.load(Ordering::SeqCst) {
            return Err(VaultError(String::from("no vault")));
        }
        self.values.lock().unwrap().remove(id);
        Ok(())
    }
}

impl FakeVault {
    fn value(&self, id: &str) -> Option<String> {
        self.values.lock().unwrap().get(id).cloned()
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

fn temp_secrets_path(label: &str) -> (TestDir, PathBuf) {
    let directory = TestDir::new(label);
    let path = directory.join(SECRETS_FILE_NAME);
    (directory, path)
}

fn load_with(path: &std::path::Path, vault: &Arc<FakeVault>) -> SecretStore {
    SecretStore::load(path.to_path_buf(), Some(Box::new(vault.clone()))).unwrap()
}

#[test]
fn a_key_left_locked_is_read_on_the_next_retry() {
    let (_directory, path) = temp_secrets_path("locked");
    let vault = Arc::new(FakeVault::default());
    load_with(&path, &vault).set("google", "key", None).unwrap();
    vault.locked.lock().unwrap().insert(String::from("google"));

    let store = load_with(&path, &vault);
    assert_eq!(store.vault_state(), VaultState::Available);
    assert!(!store.status()["google"].is_available);

    vault.locked.lock().unwrap().clear();
    assert!(
        !store.status()["google"].is_available,
        "a request does not retry"
    );
    store.vault_state();
    assert!(store.status()["google"].is_available);
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
    let (_directory, path) = temp_secrets_path("vault");
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
}

#[test]
fn an_unreadable_file_is_moved_aside() {
    let dir = TestDir::new("secrets-broken");
    let path = dir.join(SECRETS_FILE_NAME);
    fs::write(&path, "{ not json").unwrap();

    let store = SecretStore::load(path.clone(), None).unwrap();

    assert!(store.status().is_empty());
    assert!(!path.exists());
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
}

#[test]
fn without_a_vault_no_key_is_saved() {
    let (_directory, path) = temp_secrets_path("no-vault");
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
}

#[test]
fn a_refused_write_is_an_error() {
    let (_directory, path) = temp_secrets_path("read-only");
    let vault = Arc::new(FakeVault::default());
    vault.read_only.store(true, Ordering::SeqCst);

    let store = load_with(&path, &vault);
    assert!(store.set("anthropic", "an-key", None).is_err());

    assert_eq!(store.vault_state(), VaultState::Available);
    assert!(store.status().is_empty());
    // the listing written before the vault refused is taken back
    assert!(load_with(&path, &vault).status().is_empty());
}

#[test]
fn a_secret_of_an_unreachable_vault_stays_listed() {
    let (_directory, path) = temp_secrets_path("unreachable");
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
            is_available: false,
        }
    );
    assert!(offline.snapshot().is_empty());
    // removing it now would leave the key in the vault unseen
    assert!(offline.remove("google").is_err());
    assert!(offline.status().contains_key("google"));

    vault.unreachable.store(false, Ordering::SeqCst);
    assert_eq!(offline.vault_state(), VaultState::Available);
    assert!(offline.status()["google"].is_available);
    assert_eq!(offline.snapshot()["google"].value, "g-key");
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
