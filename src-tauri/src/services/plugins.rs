//! Self-contained JavaScript packages. Installation never evaluates code.
mod inspection;
mod package_format;
pub mod protocol;
mod validation;
pub use inspection::PluginInspection;
pub use validation::validate_manifest;

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::atomic_file;

const MAX_PACKAGE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_STORED_BYTES: u64 = MAX_PACKAGE_BYTES * 2 + 65_536;
const API_VERSION: u32 = 2;
const FORMAT_VERSION: u32 = 1;
/// Package keys are hex digests; a longer one is not ours.
const MAX_PACKAGE_KEY_LENGTH: usize = 256;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes_directory_field: Option<String>,
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
#[derive(Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    #[ts(type = "PluginManifest")]
    pub manifest: PluginManifest,
    /// Where `plugin://` serves the module from.
    pub module_path: String,
    /// The version the last installation replaced can be restored.
    pub has_previous_version: bool,
}

pub struct PluginStore {
    root: PathBuf,
    lock: Mutex<()>,
}
fn is_valid_plugin_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= package_format::MAX_PLUGIN_ID_LENGTH
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b" _-".contains(&byte))
        && id != package_format::RESERVED_PLUGIN_ID
}
fn read_bounded(path: &Path) -> Result<String, AppError> {
    read_with_limit(path, MAX_PACKAGE_BYTES)
}
fn read_stored(path: &Path) -> Result<String, AppError> {
    read_with_limit(path, MAX_STORED_BYTES)
}
fn read_with_limit(path: &Path, limit: u64) -> Result<String, AppError> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(AppError::InvalidInput(
            "Plugin package must be a regular file".into(),
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(AppError::FileTooLarge(
            "Plugin data exceeds the size limit".into(),
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| AppError::InvalidData("Plugin package is not UTF-8".into()))
}
pub fn inspect(path: &Path) -> Result<(PluginPackage, String), AppError> {
    let raw = read_bounded(path)?;
    let digest = format!("{:x}", Sha256::digest(raw.as_bytes()));
    let package: PluginPackage = serde_json::from_str(&raw)?;
    if package.format_version != FORMAT_VERSION {
        return Err(AppError::InvalidData(
            "Unsupported plugin package format".into(),
        ));
    }
    validate_manifest(&package.manifest)?;
    if package.module.trim().is_empty() {
        return Err(AppError::InvalidData("Plugin module is empty".into()));
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
/// The file name of a plugin: ids may differ only in case, which a
/// case-insensitive file system would not tell apart.
fn storage_key(id: &str) -> String {
    id.bytes().map(|byte| format!("{byte:02x}")).collect()
}
impl PluginStore {
    /// A directory that cannot be created leaves the app without installed
    /// plugins, which is reported when they are listed, not without a start.
    pub fn new(root: PathBuf) -> Self {
        if let Err(error) = atomic_file::create_private_dir(&root) {
            log::error!("Could not create {}: {error}", root.display());
        }
        Self {
            root,
            lock: Mutex::new(()),
        }
    }
    /// Only native metadata chooses which saved setting grants notes access.
    pub fn notes_directory_field(&self, id: &str) -> Result<String, AppError> {
        if id == "FastNote" {
            return Ok("pathToNotes".into());
        }
        if !is_valid_plugin_id(id) || BUNDLED_IDS.contains(&id) {
            return Err(AppError::PermissionDenied(
                "Plugin has no notes capability".into(),
            ));
        }
        let _guard = self.lock.locked();
        let installed: InstalledPackage = serde_json::from_str(&read_stored(
            &self.root.join(format!("{}.json", storage_key(id))),
        )?)?;
        validate_manifest(&installed.package.manifest)?;
        if installed.package.manifest.id != id
            || !installed
                .package
                .manifest
                .capabilities
                .iter()
                .any(|capability| capability == "notes")
        {
            return Err(AppError::PermissionDenied(
                "Plugin has no notes capability".into(),
            ));
        }
        Ok(installed
            .package
            .manifest
            .notes_directory_field
            .unwrap_or_else(|| "pathToNotes".into()))
    }
    pub fn install(
        &self,
        path: &Path,
        expected: &PluginManifest,
        digest: &str,
    ) -> Result<InstalledPlugin, AppError> {
        let _guard = self.lock.locked();
        let raw = read_bounded(path)?;
        if format!("{:x}", Sha256::digest(raw.as_bytes())) != digest {
            return Err(AppError::Stale(
                "Plugin package changed after inspection".into(),
            ));
        }
        let package: PluginPackage = serde_json::from_str(&raw)?;
        if package.format_version != FORMAT_VERSION || package.module.trim().is_empty() {
            return Err(AppError::InvalidData("Invalid plugin package".into()));
        }
        validate_manifest(&package.manifest)?;
        if BUNDLED_IDS.contains(&package.manifest.id.as_str()) {
            return Err(AppError::InvalidInput(
                "A package cannot replace a bundled plugin".into(),
            ));
        }
        if package.manifest != *expected {
            return Err(AppError::Stale(
                "Plugin manifest changed after inspection".into(),
            ));
        }
        let revision = crate::services::clock::now_ns().to_string();
        let key = storage_key(&package.manifest.id);
        let result = InstalledPlugin {
            manifest: package.manifest.clone(),
            module_path: format!("{key}/{revision}.js"),
            has_previous_version: self.root.join(format!("{key}.json")).exists(),
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
        let _guard = self.lock.locked();
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
                        has_previous_version: self.root.join(format!("{key}.previous")).exists(),
                    });
                }
                Err(reason) => log::warn!("Could not read installed plugin: {reason}"),
            }
        }
        result.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
        Ok(result)
    }
    pub fn restore(&self, id: &str) -> Result<(), AppError> {
        let _guard = self.lock.locked();
        if !is_valid_plugin_id(id) || BUNDLED_IDS.contains(&id) {
            return Err(AppError::InvalidInput(
                "Invalid or bundled plugin ID".into(),
            ));
        }
        let key = storage_key(id);
        let previous = self.root.join(format!("{key}.previous"));
        let raw = read_stored(&previous)?;
        let installed: InstalledPackage = serde_json::from_str(&raw)?;
        validate_manifest(&installed.package.manifest)?;
        if installed.package.manifest.id != id {
            return Err(AppError::InvalidData(
                "Invalid previous plugin identity".into(),
            ));
        }
        atomic_file::write_private(&self.root.join(format!("{key}.json")), &raw)?;
        fs::remove_file(previous)?;
        Ok(())
    }
    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let _guard = self.lock.locked();
        if !is_valid_plugin_id(id) {
            return Err(AppError::InvalidInput("Invalid plugin ID".into()));
        }
        if BUNDLED_IDS.contains(&id) {
            return Err(AppError::InvalidInput(
                "A bundled plugin cannot be removed".into(),
            ));
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
        let _guard = self.lock.locked();
        let (key, revision) = path
            .trim_start_matches('/')
            .split_once('/')
            .ok_or_else(|| AppError::InvalidInput("Invalid plugin module path".into()))?;
        if key.is_empty()
            || key.len() > MAX_PACKAGE_KEY_LENGTH
            || !key.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(AppError::InvalidInput("Invalid plugin module key".into()));
        }
        let installed: InstalledPackage =
            serde_json::from_str(&read_stored(&self.root.join(format!("{key}.json")))?)?;
        validate_manifest(&installed.package.manifest)?;
        if key != storage_key(&installed.package.manifest.id)
            || revision != format!("{}.js", installed.revision)
        {
            return Err(AppError::NotFound(
                "Plugin module revision is unavailable".into(),
            ));
        }
        Ok(installed.package.module)
    }
}

impl PluginStore {
    /// Writes a note of the plugin `id`, only under a notes root the user saved
    /// for it.
    pub fn write_note(
        &self,
        config: &serde_json::Value,
        id: &str,
        dir: &str,
        file_name: &str,
        text: &str,
        append: bool,
    ) -> Result<PathBuf, AppError> {
        let field = self.notes_directory_field(id)?;
        let roots = approved_note_roots(config, id, &field)?;
        crate::services::notes::write_scoped_note(&roots, dir, file_name, text, append)
    }
}

/// Plugin code cannot grant itself access through runtime tool arguments.
pub fn approved_note_roots(
    config: &serde_json::Value,
    id: &str,
    field: &str,
) -> Result<Vec<String>, AppError> {
    let plugin = &config["plugins"][id];
    if plugin["isEnabled"].as_bool() != Some(true) {
        return Err(AppError::PermissionDenied("Plugin is disabled".into()));
    }
    let mut roots = Vec::new();
    if let Some(root) = plugin["settings"][field]
        .as_str()
        .filter(|root| !root.trim().is_empty())
    {
        roots.push(root.to_owned());
    }
    if let Some(commands) = config["commands"].as_array() {
        let prefix = format!("{id}.");
        for command in commands {
            if command["isEnabled"].as_bool() == Some(true)
                && command["toolId"]
                    .as_str()
                    .is_some_and(|tool| tool.starts_with(&prefix))
            {
                if let Some(root) = command["toolConfig"][field]
                    .as_str()
                    .filter(|root| !root.trim().is_empty())
                {
                    roots.push(root.to_owned());
                }
            }
        }
    }
    if roots.is_empty() {
        return Err(AppError::PermissionDenied(
            "Notes directory is not configured".into(),
        ));
    }
    Ok(roots)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;
    pub(super) fn manifest() -> PluginManifest {
        let locales = validation::SUPPORTED_PLUGIN_LOCALES
            .iter()
            .map(|locale| (locale.to_string(), serde_json::json!({})))
            .collect::<serde_json::Map<_, _>>();
        serde_json::from_value(serde_json::json!({"id":"example", "version":"1.0.0", "apiVersion":2, "capabilities":["editor"], "defaultLocale":"en-US", "locales":locales})).unwrap()
    }
    pub(super) fn write_package(file: &Path, module: &str) {
        let package = PluginPackage {
            format_version: FORMAT_VERSION,
            manifest: manifest(),
            module: module.into(),
        };
        fs::write(file, serde_json::to_string(&package).unwrap()).unwrap();
    }
    fn write_note(
        store: &PluginStore,
        config: &serde_json::Value,
        id: &str,
        dir: &str,
    ) -> Result<PathBuf, AppError> {
        store.write_note(config, id, dir, "note.md", "text", false)
    }
    #[test]
    fn notes_are_written_only_under_roots_saved_for_a_notes_plugin() {
        let dir = TestDir::new("tyco-plugin-notes-");
        let store = PluginStore::new(dir.join("installed"));
        let root = dir.join("notes");
        let root_text = root.to_str().unwrap();
        let mut config = serde_json::json!({"plugins": {"FastNote": {"isEnabled": true, "settings": {"pathToNotes": root_text}}}});
        let path = write_note(
            &store,
            &config,
            "FastNote",
            root.join("day").to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "text");
        assert!(write_note(&store, &config, "FastNote", dir.to_str().unwrap()).is_err());
        config["plugins"]["FastNote"]["isEnabled"] = false.into();
        assert!(matches!(
            write_note(&store, &config, "FastNote", root_text),
            Err(AppError::PermissionDenied(_))
        ));
    }
    #[test]
    fn plugins_without_the_notes_capability_cannot_write_notes() {
        let dir = TestDir::new("tyco-plugin-no-notes-");
        let file = dir.join("example.tyco-plugin");
        write_package(&file, "export default () => ({})");
        let store = PluginStore::new(dir.join("installed"));
        store
            .install(&file, &manifest(), &package_digest(&file).unwrap())
            .unwrap();
        let root = dir.join("notes");
        let root_text = root.to_str().unwrap();
        let config = serde_json::json!({"plugins": {
            "example": {"isEnabled": true, "settings": {"pathToNotes": root_text}},
            "TextCase": {"isEnabled": true, "settings": {"pathToNotes": root_text}}
        }});
        for id in ["example", "TextCase", "missing", "../escape"] {
            assert!(
                write_note(&store, &config, id, root_text).is_err(),
                "{id} must not write notes"
            );
        }
        assert!(!root.exists());
    }
    #[test]
    fn only_saved_enabled_plugin_and_command_settings_grant_note_roots() {
        let mut config = serde_json::json!({"plugins": {"Example": {"isEnabled": true, "settings": {"notesPath": "/notes"}}}, "commands": [
            {"isEnabled": true, "toolId": "Example.write", "toolConfig": {"notesPath": "/command-notes"}},
            {"isEnabled": false, "toolId": "Example.write", "toolConfig": {"notesPath": "/disabled"}},
            {"isEnabled": true, "toolId": "Other.write", "toolConfig": {"notesPath": "/other"}}
        ]});
        assert_eq!(
            approved_note_roots(&config, "Example", "notesPath").unwrap(),
            ["/notes", "/command-notes"]
        );
        config["plugins"]["Example"]["isEnabled"] = false.into();
        assert!(approved_note_roots(&config, "Example", "notesPath").is_err());
    }
    #[test]
    fn installs_updates_serves_and_removes_only_owned_modules() {
        let dir = TestDir::new("tyco-plugin-test-");
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
    }
    #[test]
    fn installation_checks_the_reviewed_digest_and_restores_previous_revisions() {
        let dir = TestDir::new("tyco-plugin-restore-");
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
        assert!(second.has_previous_version);
        assert!(store.module(&second.module_path).unwrap().contains("two"));
        store.restore("example").unwrap();
        let restored = store.list().unwrap();
        assert!(!restored[0].has_previous_version);
        assert!(store
            .module(&restored[0].module_path)
            .unwrap()
            .contains("one"));
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
        let dir = TestDir::new("tyco-plugin-id-");
        let store = PluginStore::new(dir.to_path_buf());
        assert!(store.remove("../unsafe").is_err());
        assert!(store.restore("bundled").is_err());
    }

    #[test]
    fn incompatible_installed_packages_remain_manageable_without_being_executed() {
        let dir = TestDir::new("tyco-plugin-incompatible-test-");
        let store = PluginStore::new(dir.to_path_buf());
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
    }
}
