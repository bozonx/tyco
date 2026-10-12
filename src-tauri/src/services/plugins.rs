//! Self-contained JavaScript packages. Installation never evaluates code.
mod validation;
pub use validation::validate_manifest;

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::errors::AppError;
use crate::services::atomic_file;

const MAX_PACKAGE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_STORED_BYTES: u64 = MAX_PACKAGE_BYTES * 2 + 65_536;
const API_VERSION: u32 = 2;
const FORMAT_VERSION: u32 = 1;
const BUNDLED_IDS: &[&str] = &[
    "FastNote",
    "Diacritics",
    "TextCase",
    "WebFormatter",
    "SearchInInternet",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub id: String,
    pub version: String,
    pub api_version: u32,
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_key: Option<String>,
    pub default_locale: String,
    pub locales: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icons: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_config: Option<serde_json::Value>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPackage {
    pub format_version: u32,
    pub manifest: PluginManifest,
    pub module: String,
}
#[derive(Deserialize, Serialize)]
struct InstalledPackage {
    package: PluginPackage,
    revision: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub module_path: String,
    pub can_restore: bool,
}

pub struct PluginStore {
    root: PathBuf,
    lock: Mutex<()>,
}
fn error(message: impl Into<String>) -> AppError {
    AppError::Message(message.into())
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b" _-".contains(&byte))
        && id != "core"
}
fn read_bounded(path: &Path) -> Result<String, AppError> {
    read_with_limit(path, MAX_PACKAGE_BYTES)
}
fn read_stored(path: &Path) -> Result<String, AppError> {
    read_with_limit(path, MAX_STORED_BYTES)
}
fn read_with_limit(path: &Path, limit: u64) -> Result<String, AppError> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(error("Plugin package must be a regular file"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(error("Plugin data exceeds the size limit"));
    }
    String::from_utf8(bytes).map_err(|_| error("Plugin package is not UTF-8"))
}
pub fn inspect(path: &Path) -> Result<(PluginPackage, String), AppError> {
    let raw = read_bounded(path)?;
    let digest = format!("{:x}", Sha256::digest(raw.as_bytes()));
    let package: PluginPackage = serde_json::from_str(&raw)?;
    if package.format_version != FORMAT_VERSION {
        return Err(error("Unsupported plugin package format"));
    }
    validate_manifest(&package.manifest)?;
    if package.module.trim().is_empty() {
        return Err(error("Plugin module is empty"));
    }
    Ok((package, digest))
}
#[cfg(test)]
fn package_digest(path: &Path) -> Result<String, AppError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(read_bounded(path)?.as_bytes())
    ))
}
fn storage_key(id: &str) -> String {
    id.bytes().map(|byte| format!("{byte:02x}")).collect()
}
impl PluginStore {
    /// A directory that cannot be created leaves the app without installed
    /// plugins, which is reported when they are listed, not without a start.
    pub fn new(root: PathBuf) -> Self {
        if let Err(error) = fs::create_dir_all(&root) {
            log::error!("Could not create {}: {error}", root.display());
        }
        Self {
            root,
            lock: Mutex::new(()),
        }
    }
    pub fn install(
        &self,
        path: &Path,
        expected: &PluginManifest,
        digest: &str,
    ) -> Result<InstalledPlugin, AppError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| error("Plugin storage lock failed"))?;
        let raw = read_bounded(path)?;
        if format!("{:x}", Sha256::digest(raw.as_bytes())) != digest {
            return Err(error("Plugin package changed after inspection"));
        }
        let package: PluginPackage = serde_json::from_str(&raw)?;
        if package.format_version != FORMAT_VERSION || package.module.trim().is_empty() {
            return Err(error("Invalid plugin package"));
        }
        validate_manifest(&package.manifest)?;
        if BUNDLED_IDS.contains(&package.manifest.id.as_str()) {
            return Err(error("A package cannot replace a bundled plugin"));
        }
        if package.manifest != *expected {
            return Err(error("Plugin manifest changed after inspection"));
        }
        let revision = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| error("Could not create plugin revision"))?
            .as_nanos()
            .to_string();
        let key = storage_key(&package.manifest.id);
        let result = InstalledPlugin {
            manifest: package.manifest.clone(),
            module_path: format!("{key}/{revision}.js"),
            can_restore: self.root.join(format!("{key}.json")).exists(),
        };
        let installed = InstalledPackage { package, revision };
        let current = self.root.join(format!("{key}.json"));
        if current.exists() {
            atomic_file::write_private(
                &self.root.join(format!("{key}.previous")),
                &read_stored(&current)?,
            )?;
        }
        atomic_file::write_private(&current, &serde_json::to_string(&installed)?)?;
        Ok(result)
    }
    pub fn list(&self) -> Result<Vec<InstalledPlugin>, AppError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| error("Plugin storage lock failed"))?;
        let mut result = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let path = entry?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let parsed = read_stored(&path).and_then(|raw| {
                serde_json::from_str::<InstalledPackage>(&raw).map_err(AppError::from)
            });
            match parsed {
                Ok(installed) => {
                    let key = storage_key(&installed.package.manifest.id);
                    if path.file_stem().and_then(|value| value.to_str()) != Some(key.as_str()) {
                        continue;
                    }
                    result.push(InstalledPlugin {
                        manifest: installed.package.manifest,
                        module_path: format!("{key}/{}.js", installed.revision),
                        can_restore: self.root.join(format!("{key}.previous")).exists(),
                    });
                }
                Err(reason) => log::warn!("Could not read installed plugin: {reason}"),
            }
        }
        result.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
        Ok(result)
    }
    pub fn restore(&self, id: &str) -> Result<(), AppError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| error("Plugin storage lock failed"))?;
        if !valid_id(id) || BUNDLED_IDS.contains(&id) {
            return Err(error("Invalid or bundled plugin ID"));
        }
        let key = storage_key(id);
        let previous = self.root.join(format!("{key}.previous"));
        let raw = read_stored(&previous)?;
        let installed: InstalledPackage = serde_json::from_str(&raw)?;
        validate_manifest(&installed.package.manifest)?;
        if installed.package.manifest.id != id {
            return Err(error("Invalid previous plugin identity"));
        }
        atomic_file::write_private(&self.root.join(format!("{key}.json")), &raw)?;
        fs::remove_file(previous)?;
        Ok(())
    }
    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| error("Plugin storage lock failed"))?;
        if !valid_id(id) {
            return Err(error("Invalid plugin ID"));
        }
        if BUNDLED_IDS.contains(&id) {
            return Err(error("A bundled plugin cannot be removed"));
        }
        let previous = self.root.join(format!("{}.previous", storage_key(id)));
        if previous.exists() {
            fs::remove_file(previous)?;
        }
        let path = self.root.join(format!("{}.json", storage_key(id)));
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(reason) if reason.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(reason) => Err(reason.into()),
        }
    }
    /// Only an installed entry point can be served; arbitrary paths are rejected.
    pub fn module(&self, path: &str) -> Result<String, AppError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| error("Plugin storage lock failed"))?;
        let (key, revision) = path
            .trim_start_matches('/')
            .split_once('/')
            .ok_or_else(|| error("Invalid plugin module path"))?;
        if key.is_empty() || key.len() > 256 || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(error("Invalid plugin module key"));
        }
        let installed: InstalledPackage =
            serde_json::from_str(&read_stored(&self.root.join(format!("{key}.json")))?)?;
        validate_manifest(&installed.package.manifest)?;
        if key != storage_key(&installed.package.manifest.id)
            || revision != format!("{}.js", installed.revision)
        {
            return Err(error("Plugin module revision is unavailable"));
        }
        Ok(installed.package.module)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> PluginManifest {
        serde_json::from_value(serde_json::json!({"id":"example", "version":"1.0.0", "apiVersion":2, "capabilities":["editor"], "defaultLocale":"en_US", "locales":{"en_US":{},"ru_RU":{},"es_AR":{},"tr_TR":{}}})).unwrap()
    }
    #[test]
    fn installs_updates_serves_and_removes_only_owned_modules() {
        let dir = std::env::temp_dir().join(format!("tyco-plugin-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("example.tyco-plugin");
        let package = PluginPackage {
            format_version: FORMAT_VERSION,
            manifest: manifest(),
            module: "export default () => ({})".into(),
        };
        fs::write(&file, serde_json::to_string(&package).unwrap()).unwrap();
        let store = PluginStore::new(dir.join("installed"));
        let installed = store
            .install(&file, &manifest(), &package_digest(&file).unwrap())
            .unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(
            store.module(&installed.module_path).unwrap(),
            package.module
        );
        assert!(store.module("../example.js").is_err());
        assert!(store.module("6578616d706c65/wrong.js").is_err());
        let update = store
            .install(&file, &manifest(), &package_digest(&file).unwrap())
            .unwrap();
        assert_ne!(installed.module_path, update.module_path);
        assert!(store.module(&installed.module_path).is_err());
        let mut wrong = manifest();
        wrong.version = "2.0.0".into();
        assert!(store
            .install(&file, &wrong, &package_digest(&file).unwrap())
            .is_err());
        store.remove("example").unwrap();
        assert!(store.list().unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn installation_checks_the_reviewed_digest_and_restores_previous_revisions() {
        let dir = std::env::temp_dir().join(format!("tyco-plugin-restore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("example.tyco-plugin");
        let store = PluginStore::new(dir.join("installed"));
        let write = |module: &str| {
            let package = PluginPackage {
                format_version: FORMAT_VERSION,
                manifest: manifest(),
                module: module.into(),
            };
            fs::write(&file, serde_json::to_string(&package).unwrap()).unwrap();
        };
        write("export default () => ({ version: 'one' })");
        let first_digest = package_digest(&file).unwrap();
        store.install(&file, &manifest(), &first_digest).unwrap();
        write("export default () => ({ version: 'two' })");
        assert!(store.install(&file, &manifest(), &first_digest).is_err());
        let second_digest = package_digest(&file).unwrap();
        let second = store.install(&file, &manifest(), &second_digest).unwrap();
        assert!(second.can_restore);
        assert!(store.module(&second.module_path).unwrap().contains("two"));
        store.restore("example").unwrap();
        let restored = store.list().unwrap();
        assert!(!restored[0].can_restore);
        assert!(store
            .module(&restored[0].module_path)
            .unwrap()
            .contains("one"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_active_icons_and_invalid_remove_ids() {
        let mut value = manifest();
        value.icons = Some(
            serde_json::json!({"prefix":"mdi", "icons":{"bad":{"body":"<path onload=\"alert(1)\"/>"}}}),
        );
        assert!(validate_manifest(&value).is_err());
        value.icons = Some(serde_json::json!({
            "prefix": "mdi",
            "icons": {"bad": {"body": "<path onmouseover = \"alert(1)\"/>"}}
        }));
        assert!(validate_manifest(&value).is_err());
        let dir = std::env::temp_dir().join(format!("tyco-plugin-id-{}", std::process::id()));
        let store = PluginStore::new(dir.clone());
        assert!(store.remove("../unsafe").is_err());
        assert!(store.restore("bundled").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn incompatible_installed_packages_remain_manageable_without_being_executed() {
        let dir = std::env::temp_dir().join(format!(
            "tyco-plugin-incompatible-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        let store = PluginStore::new(dir.clone());
        let mut future = manifest();
        future.api_version = API_VERSION + 1;
        let installed = InstalledPackage {
            package: PluginPackage {
                format_version: FORMAT_VERSION,
                manifest: future,
                module: "export default () => ({})".into(),
            },
            revision: "1".into(),
        };
        fs::write(
            dir.join("6578616d706c65.json"),
            serde_json::to_string(&installed).unwrap(),
        )
        .unwrap();
        let catalog = store.list().unwrap();
        assert_eq!(catalog.len(), 1);
        assert!(store.module(&catalog[0].module_path).is_err());
        store.remove("example").unwrap();
        assert!(store.list().unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
