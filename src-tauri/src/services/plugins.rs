//! Trusted, self-contained JavaScript packages. Installation never evaluates code.
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::services::atomic_file;

const MAX_PACKAGE_BYTES: u64 = 32 * 1024 * 1024;
const API_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub version: String,
    pub api_version: u32,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub legacy_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_key: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct PluginPackage {
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
}

pub struct PluginStore {
    root: PathBuf,
    lock: Mutex<()>,
}
fn error(message: impl Into<String>) -> AppError {
    AppError::Message(message.into())
}
pub fn validate_manifest(manifest: &PluginManifest) -> Result<(), AppError> {
    let id = &manifest.id;
    if id.is_empty()
        || id.len() > 128
        || !id.as_bytes()[0].is_ascii_alphanumeric()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b" _-".contains(&byte))
        || id == "core"
    {
        return Err(error("Invalid plugin ID"));
    }
    let parts: Vec<_> = manifest.version.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(error("Plugin version must have three numeric components"));
    }
    if manifest.api_version != API_VERSION {
        return Err(error("Unsupported plugin API version"));
    }
    if manifest
        .capabilities
        .iter()
        .any(|value| !matches!(value.as_str(), "editor" | "notes" | "browser"))
    {
        return Err(error("Unknown plugin capability"));
    }
    Ok(())
}
fn read_bounded(path: &Path) -> Result<String, AppError> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(error("Plugin package must be a regular file"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(MAX_PACKAGE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_PACKAGE_BYTES {
        return Err(error("Plugin package exceeds the size limit"));
    }
    String::from_utf8(bytes).map_err(|_| error("Plugin package is not UTF-8"))
}
pub fn inspect(path: &Path) -> Result<PluginPackage, AppError> {
    let package: PluginPackage = serde_json::from_str(&read_bounded(path)?)?;
    validate_manifest(&package.manifest)?;
    if package.module.trim().is_empty() {
        return Err(error("Plugin module is empty"));
    }
    Ok(package)
}
fn storage_key(id: &str) -> String {
    id.bytes().map(|byte| format!("{byte:02x}")).collect()
}
impl PluginStore {
    pub fn new(root: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&root)?;
        Ok(Self {
            root,
            lock: Mutex::new(()),
        })
    }
    pub fn install(
        &self,
        path: &Path,
        expected: &PluginManifest,
    ) -> Result<InstalledPlugin, AppError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| error("Plugin storage lock failed"))?;
        let package = inspect(path)?;
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
        };
        let installed = InstalledPackage { package, revision };
        atomic_file::write_private(
            &self.root.join(format!("{key}.json")),
            &serde_json::to_string(&installed)?,
        )?;
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
            let parsed = read_bounded(&path).and_then(|raw| {
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
                    });
                }
                Err(reason) => log::warn!("Could not read installed plugin: {reason}"),
            }
        }
        result.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
        Ok(result)
    }
    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| error("Plugin storage lock failed"))?;
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
            serde_json::from_str(&read_bounded(&self.root.join(format!("{key}.json")))?)?;
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
        serde_json::from_value(serde_json::json!({"id":"example", "version":"1.0.0", "apiVersion":1, "capabilities":["editor"]})).unwrap()
    }
    #[test]
    fn rejects_incompatible_and_unsafe_manifests() {
        for id in ["../escape", "core", "x.y", "", "/tmp/plugin"] {
            let mut value = manifest();
            value.id = id.into();
            assert!(validate_manifest(&value).is_err());
        }
        let mut value = manifest();
        value.api_version = 2;
        assert!(validate_manifest(&value).is_err());
        value = manifest();
        value.capabilities.push("shell".into());
        assert!(validate_manifest(&value).is_err());
    }
    #[test]
    fn installs_updates_serves_and_removes_only_owned_modules() {
        let dir = std::env::temp_dir().join(format!("tyco-plugin-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("example.tyco-plugin");
        let package = PluginPackage {
            manifest: manifest(),
            module: "export default () => ({})".into(),
        };
        fs::write(&file, serde_json::to_string(&package).unwrap()).unwrap();
        let store = PluginStore::new(dir.join("installed")).unwrap();
        let installed = store.install(&file, &manifest()).unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(
            store.module(&installed.module_path).unwrap(),
            package.module
        );
        assert!(store.module("../example.js").is_err());
        assert!(store.module("6578616d706c65/wrong.js").is_err());
        let update = store.install(&file, &manifest()).unwrap();
        assert_ne!(installed.module_path, update.module_path);
        assert!(store.module(&installed.module_path).is_err());
        let mut wrong = manifest();
        wrong.version = "2.0.0".into();
        assert!(store.install(&file, &wrong).is_err());
        store.remove("example").unwrap();
        assert!(store.list().unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn incompatible_installed_packages_remain_manageable_without_being_executed() {
        let dir = std::env::temp_dir().join(format!(
            "tyco-plugin-incompatible-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        let store = PluginStore::new(dir.clone()).unwrap();
        let mut future = manifest();
        future.api_version = API_VERSION + 1;
        let installed = InstalledPackage {
            package: PluginPackage {
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
