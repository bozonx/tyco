//! The package the user picked last. The webview confirms an installation by
//! the id it was shown and never names a file to install.
use std::path::PathBuf;
use std::sync::Mutex;

use super::{PluginManifest, PluginStore};
use crate::errors::AppError;
use crate::locks::MutexExt;

struct Inspection {
    id: String,
    path: PathBuf,
    digest: String,
    manifest: PluginManifest,
}

#[derive(Default)]
pub struct PluginInspection(Mutex<Option<Inspection>>);

impl PluginInspection {
    /// Reads the manifest of a picked package without running it and keeps
    /// the package for `install`, replacing the one picked before. A package
    /// that cannot be read leaves the earlier pick in place.
    pub fn inspect(&self, path: PathBuf) -> Result<(String, PluginManifest), AppError> {
        let (package, digest) = super::inspect(&path)?;
        let id = format!("{digest}-{}", crate::services::clock::now_ns());
        *self.0.locked() = Some(Inspection {
            id: id.clone(),
            path,
            digest,
            manifest: package.manifest.clone(),
        });
        Ok((id, package.manifest))
    }

    /// Installs the package shown under `id`, once, unless the file changed
    /// since it was inspected.
    pub fn install(
        &self,
        store: &PluginStore,
        id: &str,
    ) -> Result<super::InstalledPlugin, AppError> {
        let inspection = self
            .0
            .locked()
            .take_if(|inspection| inspection.id == id)
            .ok_or_else(|| AppError::Stale("The plugin package is no longer picked".into()))?;
        store.install(&inspection.path, &inspection.manifest, &inspection.digest)
    }

    #[cfg(test)]
    fn picked_path(&self) -> Option<PathBuf> {
        self.0
            .locked()
            .as_ref()
            .map(|inspection| inspection.path.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    use crate::services::plugins::tests::{manifest, write_package};
    use crate::services::test_support::TestDir;

    fn picked(dir: &Path) -> (PluginInspection, PluginStore, PathBuf) {
        let file = dir.join("example.tyco-plugin");
        write_package(&file, "export default () => ({})");
        (
            PluginInspection::default(),
            PluginStore::new(dir.join("installed")),
            file,
        )
    }

    #[test]
    fn installs_only_the_shown_package_and_only_once() {
        let dir = TestDir::new("plugin-inspection-once");
        let (inspection, store, file) = picked(&dir);
        let (id, shown) = inspection.inspect(file).unwrap();
        assert_eq!(shown, manifest());

        assert!(matches!(
            inspection.install(&store, "other-id"),
            Err(AppError::Stale(_))
        ));
        // a wrong id does not discard the pick
        inspection.install(&store, &id).unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(matches!(
            inspection.install(&store, &id),
            Err(AppError::Stale(_))
        ));
    }

    #[test]
    fn a_new_pick_replaces_the_previous_one() {
        let dir = TestDir::new("plugin-inspection-replace");
        let (inspection, store, file) = picked(&dir);
        let (first, _) = inspection.inspect(file.clone()).unwrap();
        let (second, _) = inspection.inspect(file).unwrap();
        assert_ne!(first, second);
        assert!(inspection.install(&store, &first).is_err());
        inspection.install(&store, &second).unwrap();
    }

    #[test]
    fn an_unreadable_package_keeps_the_earlier_pick() {
        let dir = TestDir::new("plugin-inspection-invalid");
        let (inspection, store, file) = picked(&dir);
        let (id, _) = inspection.inspect(file.clone()).unwrap();
        let broken = dir.join("broken.tyco-plugin");
        std::fs::write(&broken, "not json").unwrap();
        assert!(inspection.inspect(broken).is_err());
        assert_eq!(inspection.picked_path(), Some(file));
        inspection.install(&store, &id).unwrap();
    }

    #[test]
    fn a_package_changed_after_the_pick_is_not_installed() {
        let dir = TestDir::new("plugin-inspection-changed");
        let (inspection, store, file) = picked(&dir);
        let (id, _) = inspection.inspect(file.clone()).unwrap();
        write_package(&file, "export default () => ({ changed: true })");
        assert!(matches!(
            inspection.install(&store, &id),
            Err(AppError::Stale(_))
        ));
        assert!(store.list().unwrap().is_empty());
    }
}
