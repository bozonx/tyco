use serde::{Deserialize, Serialize};

/// What a storage location holds: the user data folder (settings, history,
/// chats, plugins), the files of this device (device settings, key list), and
/// the system folders of the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum StorageKind {
    User,
    Device,
    State,
    Cache,
    Logs,
}

/// A directory the app keeps files in, with everything it holds: the
/// platform may put several kinds into one directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct StorageLocation {
    pub kinds: Vec<StorageKind>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    /// The system folders of the app; the user data folder is `user_data`.
    pub locations: Vec<StorageLocation>,
    pub user_data: UserDataState,
}

/// Whether the user data folder can be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum UserDataStatus {
    Connected,
    /// The chosen folder is missing, empty or has no `tyco-user.json`, e.g.
    /// an unmounted drive or a sync that has not arrived yet. Nothing is
    /// created or written there.
    NotConnected,
    /// A newer Tyco laid the folder out: it is read, never written.
    NewerFormat,
}

/// Where the user data folder is and whether it can be used; fixed for the
/// life of the process, as changing the folder restarts the app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct UserDataState {
    pub path: String,
    /// The folder the data is in when the user has chosen none.
    pub default_path: String,
    pub is_default: bool,
    pub status: UserDataStatus,
    /// Other users may write into the folder or its parent, and so change
    /// the commands this app runs (checked on Linux only).
    pub is_writable_by_others: bool,
}

/// How `relocate_user_data` changes the user data folder; the user says it,
/// the backend never guesses it from what a folder holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum UserDataRelocationMode {
    /// Moves the data into an empty or missing folder.
    Move,
    /// Uses a folder that holds Tyco data already; the current data stays.
    Connect,
    /// Moves the data back into the default folder, when that is empty.
    ResetToDefault,
    /// Uses the default folder with what it holds, moving nothing: after a
    /// chosen folder went missing, or to use the data left in the default one.
    UseDefault,
}

/// The fields another device changed too, where the save of this one won;
/// the version of the other device is kept in the recovery folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SettingsConflictEvent {
    pub paths: Vec<String>,
}
