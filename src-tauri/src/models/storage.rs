use serde::{Deserialize, Serialize};

/// What a storage location holds; history and chats are data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum StorageKind {
    Config,
    Data,
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
    pub locations: Vec<StorageLocation>,
}
