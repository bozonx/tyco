use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum ProjectAccessMode {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPermission {
    pub read: ProjectAccessMode,
    pub write: ProjectAccessMode,
}

/// Whether a group of tools is offered to the model, and how freely.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ToolGroupSettings {
    pub is_enabled: bool,
    /// `ask` waits for the user before each call; with no UI it means `deny`.
    pub access: ProjectAccessMode,
    /// Commands selected for this group, when the group offers them (e.g. `commands`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub command_ids: Option<Vec<String>>,
}

/// The tools a profile's chat may use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileToolSettings {
    /// By tool group id; a group that is not listed is off.
    #[serde(default)]
    pub groups: HashMap<String, ToolGroupSettings>,
    /// Model steps per turn; `DEFAULT_TOOL_STEP_COUNT` of `@tyco/shared` when
    /// unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_step_count: Option<u32>,
}

/// The memory mode of a profile.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum ProfileMemoryMode {
    #[default]
    Auto,
    Ask,
    ReadOnly,
    Off,
}

/// Summary of a memory file or topic in a profile's memory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMemoryTopic {
    pub file: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub bytes: u64,
    pub updated_at: u64,
}

/// A line matching a memory text search.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMemorySearchResult {
    pub file: String,
    pub line_number: usize,
    pub text: String,
}

/// The change applied to a profile memory file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMemoryChange {
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub before: Option<String>,
    pub after: String,
}

/// A profile; its root instruction lives next to it in `SOUL.md`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    /// The model the profile's chats run on; the first usable one when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model_id: Option<String>,
    /// The model last picked for quick AI requests in this profile; the
    /// quick request model of the settings when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub quick_request_model_id: Option<String>,
    /// Overrides the temperature of the model; the model's own when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub temperature: Option<f64>,
    /// Caps the answer length below the model's own limit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub project_permissions: HashMap<String, ProjectPermission>,
    /// No tools when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tools: Option<ProfileToolSettings>,
    /// Long-term memory mode; defaults to `auto`.
    #[serde(default)]
    pub memory_mode: ProfileMemoryMode,
    pub created_at: u64,
    pub updated_at: u64,
    /// The SHA-256 of the file as it was read, for a save to check that no
    /// other device or editor changed it since; never stored in the file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AiProject {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub is_external: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_path: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// The SHA-256 of the file as it was read, for a save to check that no
    /// other device or editor changed it since; never stored in the file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub revision: Option<String>,
    /// The folder of an external project lies inside the data folder or a
    /// vault and is synced with it; never stored in the file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_inside_synced_folder: Option<bool>,
}

/// The root instruction of a profile with its revision, empty for no file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSoul {
    pub content: String,
    pub revision: String,
}
