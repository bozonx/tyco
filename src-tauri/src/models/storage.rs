use serde::{Deserialize, Serialize};

/// What a storage location holds. Mirrors `StorageKind` in `@tyco/shared`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageKind {
    Config,
    Data,
    Cache,
    Logs,
}

/// A directory the app keeps files in, with everything it holds: the
/// platform may put several kinds into one directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageLocation {
    pub kinds: Vec<StorageKind>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub locations: Vec<StorageLocation>,
}
