use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectAccessMode {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPermission {
    pub read: ProjectAccessMode,
    pub write: ProjectAccessMode,
}

/// Whether a group of tools is offered to the model, and how freely.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolGroupSettings {
    pub is_enabled: bool,
    pub access: ProjectAccessMode,
}

/// The tools a profile's chat may use; mirrored by ProfileToolSettings in shared.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileToolSettings {
    #[serde(default)]
    pub groups: HashMap<String, ToolGroupSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_step_count: Option<u32>,
}

/// A profile; its root instruction lives next to it in `SOUL.md`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    /// The model the profile's chats run on; the first usable one when unset.
    /// Profiles written before the setting kept the last picked model.
    #[serde(
        default,
        alias = "lastModelId",
        skip_serializing_if = "Option::is_none"
    )]
    pub model_id: Option<String>,
    /// Overrides the temperature of the model; the model's own when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    /// Caps the answer length below the model's own limit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub project_permissions: HashMap<String, ProjectPermission>,
    /// No tools when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<ProfileToolSettings>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProject {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub is_external: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}
