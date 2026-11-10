//! Lock order: relocation gate, vault I/O, settings/history, file writes.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, Weak};

use crate::locks::MutexExt;

static VAULT_LOCKS: LazyLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> =
    LazyLock::new(Mutex::default);

pub(super) fn vault_lock(root: &Path) -> Arc<Mutex<()>> {
    let root = crate::services::storage::data_root_relocation::normalized(root);
    let mut locks = VAULT_LOCKS.locked();
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&root).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(root, Arc::downgrade(&lock));
    lock
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn operations_of_one_vault_exclude_each_other_but_other_vaults_are_independent() {
        let dir = TestDir::new("vault-io-locks");
        let first = vault_lock(&dir.join("personal"));
        let same = vault_lock(&dir.join("personal"));
        let other = vault_lock(&dir.join("work"));
        let _access = first.locked();
        assert!(same.try_lock().is_err());
        assert!(other.try_lock().is_ok());
    }
}
