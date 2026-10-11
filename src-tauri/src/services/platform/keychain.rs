//! The system credential store: the Keychain on macOS, the Credential Manager
//! on Windows, the Secret Service (GNOME Keyring, KWallet, KeePassXC) on
//! Linux. Each secret is one item, named by a namespace and the secret's id.
//!
//! A Linux session may have no Secret Service at all, e.g. a bare i3 or a
//! headless one; the caller then keeps the secrets elsewhere.

use crate::services::secrets::SecretVault;

pub struct SystemKeychain {
    /// The keychain "service" of every item, so that two Tyco installations
    /// with separate config directories do not share keys.
    namespace: String,
}

impl SystemKeychain {
    pub fn new(namespace: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
        }
    }

    fn entry(&self, id: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.namespace, id).map_err(describe)
    }
}

impl SecretVault for SystemKeychain {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        match self.entry(id)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(describe(error)),
        }
    }

    fn set(&self, id: &str, value: &str) -> Result<(), String> {
        self.entry(id)?.set_password(value).map_err(describe)
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        match self.entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(describe(error)),
        }
    }
}

fn describe(error: keyring::Error) -> String {
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
