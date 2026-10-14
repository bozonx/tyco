//! The system credential store: the Keychain on macOS, the Credential Manager
//! on Windows, the Secret Service (GNOME Keyring, KWallet, KeePassXC) on
//! Linux. Each secret is one item, named by a namespace and the secret's id.
//!
//! A Linux session may have no Secret Service at all, e.g. a bare i3 or a
//! headless one; the caller then keeps the secrets elsewhere.

use std::sync::{Arc, Mutex};

use keyring_core::{CredentialStore, Entry, Error};

use crate::services::secrets::SecretVault;

pub struct SystemKeychain {
    /// The keychain "service" of every item, so that two Tyco installations
    /// with separate config directories do not share keys.
    namespace: String,
    /// Opened on first use and kept once open. A store that failed to open is
    /// tried again on the next call, e.g. once the Secret Service has started.
    store: Mutex<Option<Arc<CredentialStore>>>,
}

impl SystemKeychain {
    pub fn new(namespace: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
            store: Mutex::new(None),
        }
    }

    fn store(&self) -> Result<Arc<CredentialStore>, String> {
        let mut store = self.store.lock().expect("keychain lock poisoned");
        if let Some(store) = store.as_ref() {
            return Ok(Arc::clone(store));
        }
        let opened = open_store().map_err(describe)?;
        *store = Some(Arc::clone(&opened));
        Ok(opened)
    }

    fn entry(&self, id: &str) -> Result<Entry, String> {
        self.store()?
            .build(&self.namespace, id, None)
            .map_err(describe)
    }
}

impl SecretVault for SystemKeychain {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        match self.entry(id)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(describe(error)),
        }
    }

    fn set(&self, id: &str, value: &str) -> Result<(), String> {
        self.entry(id)?.set_password(value).map_err(describe)
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        match self.entry(id)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(describe(error)),
        }
    }
}

// Each store names its items the way keyring 3 did, so keys saved by earlier
// versions stay readable.
#[cfg(target_os = "linux")]
fn open_store() -> keyring_core::Result<Arc<CredentialStore>> {
    let store: Arc<CredentialStore> = zbus_secret_service_keyring_store::Store::new()?;
    Ok(store)
}

#[cfg(target_os = "macos")]
fn open_store() -> keyring_core::Result<Arc<CredentialStore>> {
    let store: Arc<CredentialStore> = apple_native_keyring_store::keychain::Store::new()?;
    Ok(store)
}

#[cfg(target_os = "windows")]
fn open_store() -> keyring_core::Result<Arc<CredentialStore>> {
    let store: Arc<CredentialStore> = windows_native_keyring_store::Store::new()?;
    Ok(store)
}

fn describe(error: Error) -> String {
    format!("system keychain: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Talks to the real store of the session, so it runs only on request:
    /// `cargo test keychain -- --ignored`.
    #[test]
    #[ignore]
    fn round_trips_through_the_system_store() {
        let vault = SystemKeychain::new("com.tyco.app.test");
        vault.delete("round-trip").unwrap();
        assert_eq!(vault.get("round-trip").unwrap(), None);

        vault.set("round-trip", "value").unwrap();
        assert_eq!(vault.get("round-trip").unwrap().as_deref(), Some("value"));
        vault.set("round-trip", "other").unwrap();
        assert_eq!(vault.get("round-trip").unwrap().as_deref(), Some("other"));

        vault.delete("round-trip").unwrap();
        assert_eq!(vault.get("round-trip").unwrap(), None);
    }
}
