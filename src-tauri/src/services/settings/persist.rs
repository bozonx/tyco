//! The config files: read and repaired at startup, written by the saves.
//!
//! The webview sees one config. On the disk it is two parts, split by the
//! `x-scope` of the schema: `config.json` in the user data folder, which may
//! be synced to other machines, and the `config` of `device.json`, which is
//! this machine's own. The notes folders of plugins are kept on the device
//! too, see [`take_note_paths`].
//!
//! `config.json` is the one file every device rewrites. Each save merges it
//! three ways with `config.base.json` of the state folder, the version this
//! device last read or wrote: a change another device synced meanwhile
//! survives, and where both changed one field, the change just made here
//! wins and the version of the disk is kept in the recovery folder.
use crate::locks::MutexExt;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::schema::{self, ConfigPath};
use super::{merge, version};
use crate::errors::AppError;
use crate::models::{UserDataStatus, CONFIG_FILE_NAME};
use crate::services::atomic_file::{preserve_broken_copy, preserve_copy, write_private};
use crate::services::storage::device::{DeviceFile, DeviceStore};
use crate::services::storage::user_data::UserData;
use crate::services::storage::user_files::has_conflict_copy;

/// The file of the state folder that holds the merge base.
pub const CONFIG_BASE_FILE_NAME: &str = "config.base.json";
/// What the name of a config kept before a repair adds to the file name.
const REPAIRED_COPY_MARKER: &str = ".repaired-";
/// What the name of the disk's version, which lost a conflict, adds.
const DISK_COPY_MARKER: &str = ".disk-";

/// The field of a plugin's settings, and of its commands' tool config, that
/// holds its notes folder, by plugin id; `None` for a plugin without one.
pub type NotesFields<'a> = &'a dyn Fn(&str) -> Option<String>;

/// The user config the app starts with.
pub struct LoadedUserConfig {
    pub value: Value,
    /// Whether the references of the config can be trusted to collect what
    /// nothing refers to, e.g. the keys of this device: the config was read
    /// as it is, from a folder that can be written, with no conflicting copy
    /// of a sync tool next to it, which may hold references that come back.
    /// A repair that could not be written leaves the old file, whose
    /// references must not be cleaned up yet either.
    pub is_complete: bool,
}

/// A saved config, and what the disk brought into it.
pub struct SavedUserConfig {
    /// The config as saved, with the changes another device synced.
    pub value: Value,
    /// The fields another device changed too, where this save won.
    pub conflicts: Vec<String>,
}

/// A config merged with the disk, see [`ConfigFiles::merge_with_disk`].
struct Merged {
    /// `config.json` as it is on the disk, when it can be read.
    disk: Option<Value>,
    /// The part of the user data to write.
    user: Value,
    /// The whole config, as the app holds it.
    value: Value,
    conflicts: Vec<String>,
}

/// A save that failed. When the files could not be put back either, it is
/// uncertain which references they hold.
#[derive(Debug)]
pub struct SaveFailure {
    pub error: AppError,
    pub is_uncertain: bool,
}

impl From<AppError> for SaveFailure {
    fn from(error: AppError) -> Self {
        Self {
            error,
            is_uncertain: false,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigBase {
    /// The user data folder the base belongs to: another one starts anew.
    user_data_path: String,
    config: Value,
}

struct PreparedDisk {
    bytes: Option<Vec<u8>>,
}

/// The config files of this process.
pub struct ConfigFiles {
    /// `config.json`; `None` while the user data folder is not connected.
    user_path: Option<PathBuf>,
    /// Whether the user data folder takes writes.
    is_writable: bool,
    /// Why the user data folder takes no writes.
    unavailable: String,
    base_path: PathBuf,
    /// The unknown fields `device.json` brought: a save writes them back there.
    device_unknown: Mutex<HashSet<ConfigPath>>,
    /// Disk revision used to prepare runtime effects for the next save.
    prepared_disk: Mutex<Option<PreparedDisk>>,
}

impl ConfigFiles {
    pub fn new(user_data: &UserData, state_dir: &Path) -> Self {
        let user_path = (user_data.status != UserDataStatus::NotConnected)
            .then(|| user_data.dir.join(CONFIG_FILE_NAME));
        let unavailable = match user_data.dir_for(crate::services::storage::UserDirAccess::Write) {
            Ok(_) => String::new(),
            Err(error) => error.to_string(),
        };
        Self {
            user_path,
            is_writable: user_data.is_writable(),
            unavailable,
            base_path: state_dir.join(CONFIG_BASE_FILE_NAME),
            device_unknown: Mutex::default(),
            prepared_disk: Mutex::default(),
        }
    }

    #[cfg(test)]
    pub fn at(user_path: Option<PathBuf>, is_writable: bool, base_path: PathBuf) -> Self {
        Self {
            user_path,
            is_writable,
            unavailable: String::from("The data folder is not connected"),
            base_path,
            device_unknown: Mutex::default(),
            prepared_disk: Mutex::default(),
        }
    }

    fn user_data_key(&self) -> String {
        self.user_path
            .as_deref()
            .and_then(Path::parent)
            .map(|dir| dir.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    /// Reads the config. A file that cannot be parsed is set aside and the
    /// defaults take its place: the app must start either way, and the user
    /// keeps the broken file to fix it. Nothing is written into a user data
    /// folder that is not connected or read only.
    pub fn load(
        &self,
        device: &DeviceStore,
        notes: NotesFields,
    ) -> Result<LoadedUserConfig, AppError> {
        let device_file = device.snapshot();
        let device_raw = device_file.config.clone();
        let mut is_complete = self.is_writable;
        let (user_raw, user_file) = match &self.user_path {
            None => (json!({}), UserFile::Unavailable),
            Some(path) => match read_config_file(path, self.is_writable)? {
                ReadFile::Value(value) => (value, UserFile::Read),
                ReadFile::Missing => (json!({}), UserFile::Missing),
                ReadFile::Broken => {
                    is_complete = false;
                    (json!({}), UserFile::Missing)
                }
            },
        };
        if let Some(path) = &self.user_path {
            is_complete &= !has_conflict_copy(path);
        }

        // Never interpret or overwrite an unsupported future schema: it is
        // shown as it is and nothing is saved.
        if version::is_newer_than_supported(&user_raw)
            || version::is_newer_than_supported(&device_raw)
        {
            let (mut value, unknown) = join_scopes(&user_raw, &device_raw);
            put_note_paths(&mut value, &device_file, notes);
            value[version::CONFIG_VERSION_KEY] =
                json!(version::config_version(&user_raw).max(version::config_version(&device_raw)));
            *self.device_unknown.locked() = unknown;
            return Ok(LoadedUserConfig {
                value,
                is_complete: false,
            });
        }

        let (mut value, unknown) = join_scopes(&user_raw, &device_raw);
        put_note_paths(&mut value, &device_file, notes);
        schema::normalize_user_config(&mut value);
        let mut parts = Parts::of(&value, &unknown, notes);
        // a config that was not read says nothing about the commands: the
        // folders of this device stay until a config that was read drops them
        parts.keep_device_paths(&device_file, user_file != UserFile::Read);
        if user_file != UserFile::Read {
            parts.keep_device_references(&device_raw);
        }
        *self.device_unknown.locked() = unknown;

        let mut is_on_disk = true;
        let can_write_user = self.user_path.is_some() && self.is_writable;
        let rewrites_user = can_write_user
            && match user_file {
                UserFile::Missing => true,
                UserFile::Read => !keeps_every_value(&user_raw, &parts.user),
                UserFile::Unavailable => false,
            };
        // The device file goes first: device fields found in `config.json`,
        // e.g. of an earlier layout, move there before they leave it.
        let device_changed = (rewrites_user && user_file == UserFile::Read)
            || !keeps_every_value(&device_raw, &parts.device)
            || device_file.plugin_paths != parts.plugin_paths
            || device_file.plugin_command_paths != parts.plugin_command_paths;
        let device_stored = !device_changed
            || match device.update(|file| parts.store_device(file)) {
                Ok(()) => true,
                Err(error) => {
                    log::error!("Could not save the updated device settings: {error}");
                    is_on_disk = false;
                    false
                }
            };

        let mut base = (user_file == UserFile::Read).then(|| user_raw.clone());
        if let (Some(path), true, true) = (&self.user_path, rewrites_user, device_stored) {
            let preserved = user_file != UserFile::Read || keep_before_repair(path, &user_raw);
            match preserved.then(|| write_user_file(path, &parts.user)) {
                None => {
                    is_on_disk = false;
                }
                Some(Ok(())) => base = Some(parts.user.clone()),
                Some(Err(error)) => {
                    log::error!("Could not save the updated config: {error}");
                    is_on_disk = false;
                }
            }
        } else if rewrites_user {
            is_on_disk = false;
        }
        // a read only folder still sets the base a later start compares with
        if let Some(base) = base {
            self.write_base(&base);
        }
        Ok(LoadedUserConfig {
            value,
            is_complete: is_complete && is_on_disk,
        })
    }

    /// Writes `config`, which the caller has validated, merging it with what
    /// another device synced into `config.json` meanwhile. A file a newer Tyco
    /// wrote is left alone. When the device file cannot be written after the
    /// user file was, the user file is put back: the save fails as a whole.
    pub fn save(
        &self,
        device: &DeviceStore,
        notes: NotesFields,
        config: &Value,
    ) -> Result<SavedUserConfig, SaveFailure> {
        let Some(path) = self.user_path.as_deref().filter(|_| self.is_writable) else {
            return Err(AppError::UserDataUnavailable(self.unavailable.clone()).into());
        };
        let unknown = self.device_unknown.locked().clone();
        let mut parts = Parts::of(config, &unknown, notes);
        parts.keep_device_paths(&device.snapshot(), false);
        crate::services::storage::user_data::ensure_write_allowed(path)?;
        let previous_bytes = read_bytes(path)?;
        if let Some(expected) = self.prepared_disk.locked().take() {
            if previous_bytes != expected.bytes {
                return Err(AppError::Stale(
                    "Synchronized settings changed while preparing the save; retry the save".into(),
                )
                .into());
            }
        }
        let Merged {
            disk,
            user,
            value,
            conflicts,
        } = self.merge_with_disk(
            path,
            previous_bytes.as_deref(),
            &parts,
            &unknown,
            notes,
            config,
            true,
        )?;

        if disk.as_ref() != Some(&user) {
            write_user_file(path, &user)?;
        }
        let stored = device.update(|file| parts.store_device(file));
        if let Err(error) = stored {
            let restored = match &previous_bytes {
                Some(raw) => crate::services::atomic_file::write_private_bytes(path, raw),
                None => remove_if_exists(path),
            };
            return Err(match restored {
                Ok(()) => error.into(),
                Err(rollback) => SaveFailure {
                    error: AppError::Failed(format!(
                        "Could not save the device settings: {error}; could not restore config: {rollback}"
                    )),
                    is_uncertain: true,
                },
            });
        }
        self.write_base(&user);
        Ok(SavedUserConfig { value, conflicts })
    }

    /// `config` with the changes another device synced into `config.json`
    /// since this device last read or wrote it, and the fields both changed,
    /// where `config` wins; nothing is written. A save applies them before
    /// it commits anything else, so that everything it commits, e.g. the
    /// history settings, follows the merged config.
    pub fn with_disk_changes(
        &self,
        device: &DeviceStore,
        notes: NotesFields,
        config: &Value,
    ) -> Result<SavedUserConfig, AppError> {
        let Some(path) = self.user_path.as_deref().filter(|_| self.is_writable) else {
            return Err(AppError::UserDataUnavailable(self.unavailable.clone()));
        };
        let unknown = self.device_unknown.locked().clone();
        let mut parts = Parts::of(config, &unknown, notes);
        parts.keep_device_paths(&device.snapshot(), false);
        let previous_bytes = read_bytes(path)?;
        let merged = self.merge_with_disk(
            path,
            previous_bytes.as_deref(),
            &parts,
            &unknown,
            notes,
            config,
            false,
        )?;
        *self.prepared_disk.locked() = Some(PreparedDisk {
            bytes: previous_bytes,
        });
        Ok(SavedUserConfig {
            value: merged.value,
            conflicts: merged.conflicts,
        })
    }

    /// Accepts an external revision without rewriting the shared file. The base
    /// is the disk revision, so unsaved local changes remain local changes.
    pub fn accept_external(
        &self,
        device: &DeviceStore,
        notes: NotesFields,
        config: &Value,
        apply: impl FnOnce(&mut SavedUserConfig) -> Result<(), AppError>,
    ) -> Result<SavedUserConfig, AppError> {
        let path = self
            .user_path
            .as_deref()
            .ok_or_else(|| AppError::UserDataUnavailable(self.unavailable.clone()))?;
        let raw = fs::read(path)?;
        let disk: Value = serde_json::from_slice(&raw)?;
        if !disk.is_object() {
            return Err(AppError::InvalidInput("Config must be an object".into()));
        }
        let unknown = self.device_unknown.locked().clone();
        let mut parts = Parts::of(config, &unknown, notes);
        parts.keep_device_paths(&device.snapshot(), false);
        let merged = if self.read_base().is_some() {
            self.merge_with_disk(path, Some(&raw), &parts, &unknown, notes, config, true)?
        } else {
            if version::is_newer_than_supported(&disk) {
                return Err(newer_config_error());
            }
            let user = normalized_user_part(&disk, &parts.device, &unknown, notes);
            let (mut value, _) = join_scopes(&user, &parts.device);
            put_note_paths(&mut value, &parts.as_device_file(), notes);
            schema::normalize_user_config(&mut value);
            Merged {
                disk: Some(disk.clone()),
                user,
                value,
                conflicts: Vec::new(),
            }
        };
        let mut saved = SavedUserConfig {
            value: merged.value,
            conflicts: merged.conflicts,
        };
        apply(&mut saved)?;
        self.write_base(&disk);
        Ok(saved)
    }

    /// Merges `config`, split into `parts`, with `raw`, the bytes of
    /// `config.json`, three ways with the base. `keeps_copies` keeps an
    /// unreadable file, and the version of the disk that lost a conflict, in
    /// the recovery folder.
    #[allow(clippy::too_many_arguments)]
    fn merge_with_disk(
        &self,
        path: &Path,
        raw: Option<&[u8]>,
        parts: &Parts,
        unknown: &HashSet<ConfigPath>,
        notes: NotesFields,
        config: &Value,
        keeps_copies: bool,
    ) -> Result<Merged, AppError> {
        let disk = match raw {
            None => None,
            Some(raw) => match serde_json::from_slice::<Value>(raw) {
                Ok(value) if version::is_newer_than_supported(&value) => {
                    return Err(newer_config_error());
                }
                Ok(value) if value.is_object() => Some(value),
                Ok(_) | Err(_) => {
                    // the config in memory is valid, and refusing every save
                    // would not get the file fixed
                    if keeps_copies {
                        let copy = preserve_broken_copy(path, raw)?;
                        log::warn!(
                            "The config on the disk is unreadable; kept it at {} and wrote the current one",
                            copy.display()
                        );
                    }
                    None
                }
            },
        };
        let mut merged = Merged {
            user: parts.user.clone(),
            value: config.clone(),
            conflicts: Vec::new(),
            disk: disk.clone(),
        };
        let (Some(disk), Some(base)) = (disk, self.read_base()) else {
            return Ok(merged);
        };
        if disk != base {
            let device_part = &parts.device;
            let disk_part = normalized_user_part(&disk, device_part, unknown, notes);
            let base_part = normalized_user_part(&base, device_part, unknown, notes);
            let (user, lost) = merge::merge_preferring_next(&disk_part, &base_part, &merged.user)?;
            if keeps_copies && !lost.is_empty() {
                if let Some(raw) = raw {
                    let copy = preserve_copy(path, DISK_COPY_MARKER, raw)?;
                    log::warn!(
                        "Settings changed on another device too ({}); kept its version at {}",
                        lost.join(", "),
                        copy.display()
                    );
                }
            }
            merged.conflicts = lost;
            // what the other device removed may leave references of this
            // one dangling: the merge is repaired like a file read
            let (mut joined, _) = join_scopes(&user, device_part);
            put_note_paths(&mut joined, &parts.as_device_file(), notes);
            schema::normalize_user_config(&mut joined);
            merged.user = Parts::of(&joined, unknown, notes).user;
            merged.value = joined;
        }
        Ok(merged)
    }

    fn read_base(&self) -> Option<Value> {
        let raw = fs::read(&self.base_path).ok()?;
        let base: ConfigBase = serde_json::from_slice(&raw).ok()?;
        (base.user_data_path == self.user_data_key() && base.config.is_object())
            .then_some(base.config)
    }

    /// The base is derived: a failure costs a merge, never the settings.
    fn write_base(&self, config: &Value) {
        let base = ConfigBase {
            user_data_path: self.user_data_key(),
            config: config.clone(),
        };
        let written = self
            .base_path
            .parent()
            .map_or(Ok(()), crate::services::atomic_file::create_private_dir)
            .and_then(|()| Ok(serde_json::to_string(&base)?))
            .and_then(|raw| write_private(&self.base_path, &raw));
        if let Err(error) = written {
            log::warn!("Could not save the settings merge base: {error}");
        }
    }
}

/// The base is reset when the user data folder changes: the disk of the new
/// one is taken as it is.
pub fn reset_base(state_dir: &Path) -> Result<(), AppError> {
    remove_if_exists(&state_dir.join(CONFIG_BASE_FILE_NAME))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum UserFile {
    Read,
    Missing,
    Unavailable,
}

enum ReadFile {
    Value(Value),
    Missing,
    Broken,
}

/// Reads a config file; a broken one is set aside.
fn read_config_file(path: &Path, can_repair: bool) -> Result<ReadFile, AppError> {
    let Some(raw) = read_bytes(path)? else {
        return Ok(ReadFile::Missing);
    };
    match serde_json::from_slice::<Value>(&raw) {
        Ok(value) if value.is_object() => Ok(ReadFile::Value(value)),
        _ => {
            if can_repair {
                crate::services::atomic_file::quarantine(path)?;
            }
            Ok(ReadFile::Broken)
        }
    }
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    match fs::read(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn remove_if_exists(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// A repair that drops or replaces a value keeps the file it read, so that a
/// bug in the repair never loses the settings for good.
fn keep_before_repair(path: &Path, original: &Value) -> bool {
    match serde_json::to_string_pretty(original)
        .map_err(AppError::from)
        .and_then(|raw| preserve_copy(path, REPAIRED_COPY_MARKER, raw.as_bytes()))
    {
        Ok(copy) => {
            log::warn!(
                "Repaired the config; kept the previous one at {}",
                copy.display()
            );
            true
        }
        Err(error) => {
            log::error!("Could not keep the config before a repair: {error}");
            false
        }
    }
}

fn write_user_file(path: &Path, user: &Value) -> Result<(), AppError> {
    write_private(path, &serde_json::to_string_pretty(user)?)
}

/// The parts of the user data and of the device joined; the version of the
/// device part is the one of the user part.
fn join_scopes(user: &Value, device: &Value) -> (Value, HashSet<ConfigPath>) {
    let mut device = device.clone();
    if let Some(fields) = device.as_object_mut() {
        fields.shift_remove(version::CONFIG_VERSION_KEY);
    }
    schema::join_scopes(user, &device)
}

/// A config split for the disk: the part of the user data, the part of the
/// device and the notes folders of the plugins.
struct Parts {
    user: Value,
    device: Value,
    plugin_paths: BTreeMap<String, String>,
    plugin_command_paths: BTreeMap<String, String>,
    owners: NoteOwners,
}

impl Parts {
    fn of(config: &Value, device_unknown: &HashSet<ConfigPath>, notes: NotesFields) -> Self {
        let mut config = config.clone();
        let taken = take_note_paths(&mut config, notes);
        let (user, mut device) = schema::split_by_scope(&config, device_unknown);
        if let Some(version) = config.get(version::CONFIG_VERSION_KEY) {
            device[version::CONFIG_VERSION_KEY] = version.clone();
        }
        Self {
            user,
            device,
            plugin_paths: taken.plugin_paths,
            plugin_command_paths: taken.command_paths,
            owners: taken.owners,
        }
    }

    /// Keeps the folders of `device` the config has no field for: a plugin
    /// without saved settings, and, when `keeps_missing_commands`, a command
    /// the config does not hold, as one that was not read says nothing about
    /// it. The folder of a command a config that was read no longer holds is
    /// dropped.
    fn keep_device_paths(&mut self, device: &DeviceFile, keeps_missing_commands: bool) {
        for (id, path) in &device.plugin_paths {
            if !self.owners.plugins.contains(id) {
                self.plugin_paths
                    .entry(id.clone())
                    .or_insert_with(|| path.clone());
            }
        }
        if keeps_missing_commands {
            for (id, path) in &device.plugin_command_paths {
                if !self.owners.commands.contains(id) {
                    self.plugin_command_paths
                        .entry(id.clone())
                        .or_insert_with(|| path.clone());
                }
            }
        }
    }

    /// Keeps the device values of entities the config has not got, the values
    /// of variables: a config that was not read says nothing about which entities are gone.
    fn keep_device_references(&mut self, device_raw: &Value) {
        let pointer = "/variableValues";
        let Some(kept) = device_raw.pointer(pointer).and_then(Value::as_object) else {
            return;
        };
        let Some(current) = ensure_object_at(&mut self.device, pointer) else {
            return;
        };
        for (id, value) in kept {
            if value.is_string() && !current.contains_key(id) {
                current.insert(id.clone(), value.clone());
            }
        }
    }

    fn store_device(&self, file: &mut DeviceFile) {
        file.config = self.device.clone();
        file.plugin_paths = self.plugin_paths.clone();
        file.plugin_command_paths = self.plugin_command_paths.clone();
    }

    fn as_device_file(&self) -> DeviceFile {
        let mut file = DeviceFile::default();
        self.store_device(&mut file);
        file
    }
}

/// The object at `pointer` of `value`, created with its parents when missing;
/// `None` when something that is not an object is in the way.
fn ensure_object_at<'a>(
    value: &'a mut Value,
    pointer: &str,
) -> Option<&'a mut serde_json::Map<String, Value>> {
    let mut current = value;
    for key in pointer.split('/').skip(1) {
        current = current
            .as_object_mut()?
            .entry(key)
            .or_insert_with(|| json!({}));
    }
    current.as_object_mut()
}

/// The user part of a `config.json` as it would be read with `device`: the
/// three sides of a merge are compared in one form.
fn normalized_user_part(
    user: &Value,
    device: &Value,
    device_unknown: &HashSet<ConfigPath>,
    notes: NotesFields,
) -> Value {
    let (mut joined, _) = join_scopes(user, device);
    schema::normalize_user_config(&mut joined);
    Parts::of(&joined, device_unknown, notes).user
}

/// The plugin a command's tool belongs to: `<plugin id>.<tool>`.
fn tool_plugin(tool_id: &str) -> Option<&str> {
    tool_id.split_once('.').map(|(plugin, _)| plugin)
}

/// The plugins whose settings hold a notes folder field, and the commands the
/// config holds, by id: the config decides their folders.
#[derive(Default)]
struct NoteOwners {
    plugins: HashSet<String>,
    commands: HashSet<String>,
}

/// The notes folders a config held, see [`take_note_paths`].
struct TakenNotePaths {
    plugin_paths: BTreeMap<String, String>,
    command_paths: BTreeMap<String, String>,
    owners: NoteOwners,
}

/// Takes the notes folders out of the plugin settings and the commands of
/// plugins, leaving empty strings: a folder means something on one machine
/// only, so each device sets its own. Returns them by plugin id and by
/// command id.
fn take_note_paths(config: &mut Value, notes: NotesFields) -> TakenNotePaths {
    let mut owners = NoteOwners::default();
    for command in config["commands"].as_array().into_iter().flatten() {
        if let Some(id) = command["id"].as_str() {
            owners.commands.insert(id.to_owned());
        }
    }
    let mut plugin_paths = BTreeMap::new();
    if let Some(plugins) = config["plugins"].as_object_mut() {
        for (id, plugin) in plugins {
            let Some(field) = notes(id) else {
                continue;
            };
            if let Some(path) = plugin["settings"].get_mut(&field) {
                if path.is_string() {
                    owners.plugins.insert(id.clone());
                }
                if let Some(text) = path.as_str().filter(|text| !text.trim().is_empty()) {
                    plugin_paths.insert(id.clone(), text.to_owned());
                }
                if path.is_string() {
                    *path = json!("");
                }
            }
        }
    }
    let mut command_paths = BTreeMap::new();
    for command in config["commands"].as_array_mut().into_iter().flatten() {
        let Some(field) = command["toolId"]
            .as_str()
            .and_then(tool_plugin)
            .and_then(notes)
        else {
            continue;
        };
        let id = command["id"].as_str().unwrap_or_default().to_owned();
        if let Some(path) = command["toolConfig"].get_mut(&field) {
            if let Some(text) = path.as_str().filter(|text| !text.trim().is_empty()) {
                command_paths.insert(id, text.to_owned());
            }
            if path.is_string() {
                *path = json!("");
            }
        }
    }
    TakenNotePaths {
        plugin_paths,
        command_paths,
        owners,
    }
}

/// Puts the notes folders of this device back into the config. One of a
/// plugin or a command the config no longer has is left out.
fn put_note_paths(config: &mut Value, device: &DeviceFile, notes: NotesFields) {
    if let Some(plugins) = config["plugins"].as_object_mut() {
        for (id, path) in &device.plugin_paths {
            let (Some(field), Some(Value::Object(plugin))) = (notes(id), plugins.get_mut(id))
            else {
                continue;
            };
            let settings = plugin.entry("settings").or_insert_with(|| json!({}));
            if let Some(settings) = settings.as_object_mut() {
                settings.insert(field, json!(path));
            }
        }
    }
    for command in config["commands"].as_array_mut().into_iter().flatten() {
        let Some(path) = command["id"]
            .as_str()
            .and_then(|id| device.plugin_command_paths.get(id))
        else {
            continue;
        };
        let Some(field) = command["toolId"]
            .as_str()
            .and_then(tool_plugin)
            .and_then(notes)
        else {
            continue;
        };
        if !command["toolConfig"].is_object() {
            command["toolConfig"] = json!({});
        }
        command["toolConfig"][field] = json!(path);
    }
}

/// Whether `repaired` still holds every value of `original`, so that the
/// repair only added fields or stamped the version.
fn keeps_every_value(original: &Value, repaired: &Value) -> bool {
    match (original, repaired) {
        (Value::Object(original), Value::Object(repaired)) => {
            original.iter().all(|(key, value)| {
                key == version::CONFIG_VERSION_KEY
                    || repaired
                        .get(key)
                        .is_some_and(|kept| keeps_every_value(value, kept))
            })
        }
        (Value::Array(original), Value::Array(repaired)) => {
            original.len() == repaired.len()
                && original
                    .iter()
                    .zip(repaired)
                    .all(|(value, kept)| keeps_every_value(value, kept))
        }
        _ => original == repaired,
    }
}

pub fn newer_config_error() -> AppError {
    AppError::UnsupportedConfig(String::from(
        "The config was written by a newer version of Tyco; update Tyco to open this configuration",
    ))
}

#[cfg(test)]
mod tests;
