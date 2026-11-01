//! `device.json`: what belongs to this machine only. It holds the device part
//! of the user config (hotkeys, window insertion, …, see `x-scope` of the
//! schema) and the fields of the device itself, which the settings never
//! show: its id, the machine it was made on, where the user data folder is,
//! the paths of the plugins that write notes and the folders of the external
//! projects of the AI profiles.
use crate::locks::MutexExt;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::errors::AppError;
use crate::services::atomic_file::{read_or_quarantine, write_private};

pub const DEVICE_FILE_NAME: &str = "device.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFile {
    /// A UUID made on the first start; it names the history journal of the
    /// device in the user data folder.
    #[serde(default)]
    pub device_id: String,
    /// The id of the machine `device_id` was made on, see `machine_id`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub machine_id: String,
    /// The user data folder the user chose; empty for the default one.
    #[serde(default)]
    pub user_data_path: String,
    /// The notes folder of a plugin's settings on this device, by plugin id.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub plugin_paths: BTreeMap<String, String>,
    /// The notes folder of a plugin command on this device, by command id.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub plugin_command_paths: BTreeMap<String, String>,
    /// The folder of an external project of the AI profiles on this
    /// device: by the id of its vault (see `ai_vault::marker`), then by the
    /// project id.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub ai_project_paths: BTreeMap<String, BTreeMap<String, String>>,
    /// The device part of the user config, its `configVersion` included.
    #[serde(default = "empty_object")]
    pub config: Value,
    /// Fields of a newer build, kept as they are.
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

fn empty_object() -> Value {
    Value::Object(Map::new())
}

impl Default for DeviceFile {
    fn default() -> Self {
        Self {
            device_id: String::new(),
            machine_id: String::new(),
            user_data_path: String::new(),
            plugin_paths: BTreeMap::new(),
            plugin_command_paths: BTreeMap::new(),
            ai_project_paths: BTreeMap::new(),
            config: empty_object(),
            other: Map::new(),
        }
    }
}

/// The device file, read once at startup and written by its owners: the
/// settings saves and the change of the user data folder.
pub struct DeviceStore {
    path: Option<PathBuf>,
    file: Mutex<DeviceFile>,
}

impl DeviceStore {
    /// Reads the device file, giving the device an id on the first start and
    /// a new one when the file came from another machine. A file that cannot
    /// be parsed is set aside: the device settings start from the defaults.
    pub fn open(path: PathBuf, machine_id: Option<String>) -> Result<Self, AppError> {
        let mut file = read_or_quarantine(&path, |raw| {
            let value: Value = serde_json::from_str(raw)?;
            if !value.is_object() {
                return Err(AppError::invalid_data("the device file is not a mapping"));
            }
            Ok(serde_json::from_value::<DeviceFile>(value)?)
        })?
        .unwrap_or_default();
        if !file.config.is_object() {
            file.config = empty_object();
        }
        if ensure_identity(
            &mut file,
            machine_id.as_deref(),
            crate::services::random_id::new_uuid,
        ) {
            if let Err(error) = write_device_file(&path, &file) {
                log::error!("Could not save the device id: {error}");
            }
        }
        Ok(Self {
            path: Some(path),
            file: Mutex::new(file),
        })
    }

    /// A store kept in memory only, for tests.
    #[cfg(test)]
    pub fn in_memory(file: DeviceFile) -> Self {
        Self {
            path: None,
            file: Mutex::new(file),
        }
    }

    pub fn snapshot(&self) -> DeviceFile {
        self.file.locked().clone()
    }

    pub fn device_id(&self) -> String {
        self.file.locked().device_id.clone()
    }

    /// Changes the file and writes it; on a failed write the change is
    /// undone in memory too.
    pub fn update<T>(&self, change: impl FnOnce(&mut DeviceFile) -> T) -> Result<T, AppError> {
        let mut file = self.file.locked();
        let mut next = file.clone();
        let value = change(&mut next);
        if next != *file {
            if let Some(path) = &self.path {
                write_device_file(path, &next)?;
            }
            *file = next;
        }
        Ok(value)
    }
}

fn write_device_file(path: &Path, file: &DeviceFile) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        crate::services::atomic_file::create_private_dir(dir)?;
    }
    write_private(path, &serde_json::to_string_pretty(file)?)
}

/// Gives the device an id when it has none, and a new one when `machine_id`
/// tells that the file was made on another machine, e.g. restored from a
/// backup there or copied with a virtual machine: two devices must never
/// write the same history journal. Returns whether the file changed.
fn ensure_identity(
    file: &mut DeviceFile,
    machine_id: Option<&str>,
    new_id: impl FnOnce() -> String,
) -> bool {
    let mut changed = false;
    let is_copy = match machine_id {
        Some(machine) if file.machine_id != machine => {
            let is_copy = !file.machine_id.is_empty();
            file.machine_id = machine.to_owned();
            changed = true;
            is_copy
        }
        _ => false,
    };
    if !is_device_id(&file.device_id) || is_copy {
        let previous = std::mem::replace(&mut file.device_id, new_id());
        if is_copy {
            log::warn!(
                "The device file was made on another machine; this device gets the id {} instead of {previous}",
                file.device_id
            );
        }
        changed = true;
    }
    changed
}

/// Whether `id` is a UUID in its canonical lowercase form, as device ids are:
/// it names a file in the user data folder.
pub fn is_device_id(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_digit() || ('a'..='f').contains(&c),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;
    use serde_json::json;

    const ID: &str = "0b7d6f0e-1c2a-4b3c-8d4e-5f6a7b8c9d0e";

    #[test]
    fn device_ids_are_canonical_uuids() {
        let id = crate::services::random_id::new_uuid();
        assert!(is_device_id(&id), "{id}");
        assert_ne!(id, crate::services::random_id::new_uuid());
        assert!(is_device_id(ID));
        assert!(!is_device_id("0B7D6F0E-1C2A-4B3C-8D4E-5F6A7B8C9D0E"));
        assert!(!is_device_id("../x"));
    }

    #[test]
    fn a_device_gets_an_id_once() {
        let mut file = DeviceFile::default();
        assert!(ensure_identity(&mut file, Some("m1"), || ID.into()));
        assert_eq!(file.device_id, ID);
        assert_eq!(file.machine_id, "m1");
        assert!(!ensure_identity(&mut file, Some("m1"), || panic!(
            "no new id"
        )));
    }

    #[test]
    fn a_copy_on_another_machine_gets_a_new_id_and_keeps_the_rest() {
        let mut file = DeviceFile {
            device_id: ID.into(),
            machine_id: "m1".into(),
            user_data_path: "/sync/tyco".into(),
            ..DeviceFile::default()
        };
        assert!(ensure_identity(&mut file, Some("m2"), || "other".into()));
        assert_eq!(file.device_id, "other");
        assert_eq!(file.machine_id, "m2");
        assert_eq!(file.user_data_path, "/sync/tyco");
    }

    #[test]
    fn an_unknown_machine_skips_the_check() {
        let mut file = DeviceFile {
            device_id: ID.into(),
            machine_id: "m1".into(),
            ..DeviceFile::default()
        };
        assert!(!ensure_identity(&mut file, None, || panic!("no new id")));
        // a file made where the machine was unknown takes the id it now has
        let mut file = DeviceFile {
            device_id: ID.into(),
            ..DeviceFile::default()
        };
        assert!(ensure_identity(&mut file, Some("m1"), || panic!(
            "no new id"
        )));
        assert_eq!(file.device_id, ID);
    }

    #[test]
    fn the_file_keeps_unknown_fields_and_survives_a_restart() {
        let dir = TestDir::new("device-file");
        let path = dir.join(DEVICE_FILE_NAME);
        std::fs::write(
            &path,
            json!({"deviceId": ID, "machineId": "m1", "future": {"a": 1}}).to_string(),
        )
        .unwrap();
        let store = DeviceStore::open(path.clone(), Some("m1".into())).unwrap();
        assert_eq!(store.device_id(), ID);
        store
            .update(|file| file.user_data_path = "/sync".into())
            .unwrap();
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["future"], json!({"a": 1}));
        assert_eq!(saved["userDataPath"], "/sync");
        let reopened = DeviceStore::open(path, Some("m1".into())).unwrap();
        assert_eq!(reopened.snapshot().user_data_path, "/sync");
    }

    #[test]
    fn a_broken_file_starts_a_new_device() {
        let dir = TestDir::new("device-file-broken");
        let path = dir.join(DEVICE_FILE_NAME);
        std::fs::write(&path, "[1").unwrap();
        let store = DeviceStore::open(path.clone(), None).unwrap();
        assert!(is_device_id(&store.device_id()));
        assert!(path.is_file());
    }
}
