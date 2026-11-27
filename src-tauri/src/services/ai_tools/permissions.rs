//! Whether a tool the backend runs may be called where the call comes from:
//! the "Ask AI" chat, a profile's chat or an AI command. The webview decides
//! what to offer and asks the user about `ask`; this checks every call again
//! by what the user configured, read anew each time, so that a call the
//! webview should not have made is refused. It never knows whether the user
//! was asked: it checks that the source and the tool are not switched off
//! everywhere nor in the profile, and, for files, that the project's
//! permission is not `deny`.
//! See `dev_docs/architecture.md`, "Tool sources and permissions".

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::AppError;
use crate::models::user_config;
use crate::services::ai_vault::{AiProfile, ToolState};

/// The kind of the built-in tool sources.
pub const CORE_SOURCE_KIND: &str = "core";
/// The core source of the file tools.
pub const FILES_SOURCE_ID: &str = "files";
/// The core source of the web tools.
pub const WEB_SOURCE_ID: &str = "web";

/// Where a tool call comes from.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ToolCallContext {
    /// The "Ask AI" chat: no profile, the web tools by its switch.
    AskAi,
    /// A profile's chat, by the profile's tool settings.
    Profile { profile_id: String },
    /// An AI command, by its whitelist.
    AiCommand { command_id: String },
}

impl ToolCallContext {
    /// The profile of a profile chat.
    pub fn profile_id(&self) -> Option<&str> {
        match self {
            Self::Profile { profile_id } => Some(profile_id),
            _ => None,
        }
    }
}

/// A reference to a tool source or one of its tools, as an AI command's
/// whitelist keeps it.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRef {
    pub source_kind: String,
    pub source_id: String,
    #[serde(default)]
    pub tool_name: Option<String>,
}

/// Escapes the key separator in one part of a key; keep in sync with
/// `keyPart` in `lib/chat-tools/tool-catalog.ts`.
fn key_part(part: &str) -> String {
    part.replace('%', "%25").replace(':', "%3A")
}

/// The key of a source in the settings: `<kind>:<id>`.
pub fn source_key(kind: &str, id: &str) -> String {
    format!("{}:{}", key_part(kind), key_part(id))
}

/// The key of a tool in the settings: `<kind>:<id>:<tool>`.
pub fn tool_key(kind: &str, id: &str, tool: &str) -> String {
    format!("{}:{}", source_key(kind, id), key_part(tool))
}

/// Whether a core tool is on in the profile: its source is not switched off
/// and the tool itself is not `off`. Core sources are on by default.
pub fn is_core_tool_enabled(profile: &AiProfile, source_id: &str, tool_name: &str) -> bool {
    is_core_source_enabled(profile, source_id)
        && profile.tools.as_ref().is_none_or(|settings| {
            settings
                .tools
                .get(&tool_key(CORE_SOURCE_KIND, source_id, tool_name))
                != Some(&ToolState::Off)
        })
}

/// Whether the profile has a core source on; it is by default.
pub fn is_core_source_enabled(profile: &AiProfile, source_id: &str) -> bool {
    profile.tools.as_ref().is_none_or(|settings| {
        settings
            .sources
            .get(&source_key(CORE_SOURCE_KIND, source_id))
            .is_none_or(|source| source.is_enabled)
    })
}

/// Whether a tool is available at all: neither its source nor the tool is
/// switched off everywhere (`tools` of the user config). Keep in sync with
/// `isToolAvailable` in `lib/chat-tools/tool-catalog.ts`.
pub fn is_tool_available(config: &Value, kind: &str, source_id: &str, tool_name: &str) -> bool {
    let is_on = |group: &str, key: &str| {
        config
            .get("tools")
            .and_then(|tools| tools.get(group))
            .and_then(|items| items.get(key))
            .and_then(|item| item.get("isEnabled"))
            .and_then(Value::as_bool)
            != Some(false)
    };
    is_on("sources", &source_key(kind, source_id))
        && is_on("tools", &tool_key(kind, source_id, tool_name))
}

/// Whether a whitelist has a tool: the whole source or the tool itself.
pub fn whitelist_has(refs: &[ToolRef], kind: &str, source_id: &str, tool_name: &str) -> bool {
    refs.iter().any(|item| {
        item.source_kind == kind
            && item.source_id == source_id
            && item
                .tool_name
                .as_deref()
                .is_none_or(|name| name == tool_name)
    })
}

/// The whitelist of an AI command; empty for a command that is not one.
pub fn ai_command_tools(config: &Value, command_id: &str) -> Vec<ToolRef> {
    user_config::ai_command_tools(config, command_id)
        .into_iter()
        .filter_map(|value| ToolRef::deserialize(value).ok())
        .collect()
}

fn refused(message: impl Into<String>) -> AppError {
    AppError::InvalidInput(message.into())
}

/// Checks that a web tool may be called in `context`. `profile` is the
/// profile of a profile chat, read for this call.
pub fn ensure_web_tool_allowed(
    context: &ToolCallContext,
    tool_name: &str,
    config: &Value,
    profile: Option<&AiProfile>,
) -> Result<(), AppError> {
    // "Ask AI" has its own web switch; the catalog is for profiles and commands
    let is_available = matches!(context, ToolCallContext::AskAi)
        || is_tool_available(config, CORE_SOURCE_KIND, WEB_SOURCE_ID, tool_name);
    let is_allowed = is_available
        && match context {
            ToolCallContext::AskAi => user_config::is_ask_ai_web_search_enabled(config),
            ToolCallContext::Profile { .. } => profile
                .is_some_and(|profile| is_core_tool_enabled(profile, WEB_SOURCE_ID, tool_name)),
            ToolCallContext::AiCommand { command_id } => whitelist_has(
                &ai_command_tools(config, command_id),
                CORE_SOURCE_KIND,
                WEB_SOURCE_ID,
                tool_name,
            ),
        };
    if is_allowed {
        Ok(())
    } else {
        Err(refused(format!("{tool_name} is not enabled here")))
    }
}

/// Checks that a file tool may be called: it is not switched off everywhere
/// and, in a profile's chat, the profile has its file source on. A profile
/// does not set the file tools one by one: the project permissions decide. The "Ask AI" chat reaches
/// its attachments only and an AI command no files at all; the file tools
/// enforce that by the roots they are given.
pub fn ensure_file_tool_allowed(
    config: &Value,
    profile: Option<&AiProfile>,
    tool_name: &str,
) -> Result<(), AppError> {
    if is_tool_available(config, CORE_SOURCE_KIND, FILES_SOURCE_ID, tool_name)
        && profile.is_none_or(|profile| is_core_source_enabled(profile, FILES_SOURCE_ID))
    {
        Ok(())
    } else {
        Err(refused(format!(
            "{tool_name} is turned off for this profile"
        )))
    }
}

/// The IPC commands the chat tools call. None of them changes the settings,
/// the profiles, the projects or the commands: a tool cannot raise its own
/// permissions. The test below keeps it so.
#[cfg(test)]
pub const TOOL_COMMANDS: &[&str] = &[
    "list_ai_file_roots",
    "run_ai_file_tool",
    "preview_ai_file_change",
    "read_ai_file_bytes",
    "run_ai_web_tool",
    "cancel_ai_web_tool",
    "read_ai_profile_memory",
    "peek_ai_profile_memory",
    "search_ai_profile_memory",
    "list_ai_profile_memory_topics",
    "add_ai_profile_memory_fact",
    "replace_ai_profile_memory",
    "rewrite_ai_profile_memory",
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::ai_vault::{ProfileToolSettings, ToolSourceSettings};
    use serde_json::json;
    use std::collections::HashMap;

    fn profile(tools: Option<ProfileToolSettings>) -> AiProfile {
        AiProfile {
            id: "p1".into(),
            name: "Profile".into(),
            model_id: None,
            quick_request_model_id: None,
            temperature: None,
            max_output_tokens: None,
            project_permissions: HashMap::new(),
            tools,
            memory_mode: Default::default(),
            created_at: 1,
            updated_at: 1,
            revision: None,
        }
    }

    fn settings(sources: &[(&str, bool)], tools: &[(&str, ToolState)]) -> ProfileToolSettings {
        ProfileToolSettings {
            sources: sources
                .iter()
                .map(|(key, is_enabled)| {
                    (
                        (*key).to_string(),
                        ToolSourceSettings {
                            is_enabled: *is_enabled,
                        },
                    )
                })
                .collect(),
            tools: tools
                .iter()
                .map(|(key, state)| ((*key).to_string(), *state))
                .collect(),
            command_ids: Vec::new(),
        }
    }

    fn profile_context() -> ToolCallContext {
        ToolCallContext::Profile {
            profile_id: "p1".into(),
        }
    }

    #[test]
    fn keys_escape_the_separator() {
        assert_eq!(source_key("core", "web"), "core:web");
        assert_eq!(tool_key("mcp", "srv", "a:b%c"), "mcp:srv:a%3Ab%25c");
    }

    #[test]
    fn ask_ai_follows_its_web_switch() {
        let context = ToolCallContext::AskAi;
        assert!(ensure_web_tool_allowed(&context, "web_search", &json!({}), None).is_ok());
        let off = json!({ "llm": { "tasks": { "chat": { "isWebSearchEnabled": false } } } });
        assert!(ensure_web_tool_allowed(&context, "web_fetch", &off, None).is_err());
        let on = json!({ "llm": { "tasks": { "chat": { "isWebSearchEnabled": true } } } });
        assert!(ensure_web_tool_allowed(&context, "web_fetch", &on, None).is_ok());
    }

    #[test]
    fn a_profile_has_the_core_tools_by_default() {
        let config = json!({});
        let profile = profile(None);
        assert!(
            ensure_web_tool_allowed(&profile_context(), "web_fetch", &config, Some(&profile))
                .is_ok()
        );
        assert!(ensure_file_tool_allowed(&config, Some(&profile), "delete_path").is_ok());
    }

    #[test]
    fn a_profile_refuses_a_source_or_tool_switched_off() {
        let config = json!({});
        let source_off = profile(Some(settings(&[("core:web", false)], &[])));
        assert!(ensure_web_tool_allowed(
            &profile_context(),
            "web_search",
            &config,
            Some(&source_off)
        )
        .is_err());
        let tool_off = profile(Some(settings(
            &[],
            &[("core:web:web_fetch", ToolState::Off)],
        )));
        assert!(
            ensure_web_tool_allowed(&profile_context(), "web_fetch", &config, Some(&tool_off))
                .is_err()
        );
        assert!(ensure_web_tool_allowed(
            &profile_context(),
            "web_search",
            &config,
            Some(&tool_off)
        )
        .is_ok());
        let asking = profile(Some(settings(
            &[],
            &[("core:files:write_file", ToolState::Ask)],
        )));
        assert!(ensure_file_tool_allowed(&config, Some(&asking), "write_file").is_ok());
        // the profile does not switch file tools one by one: the projects decide
        let file_tool_off = profile(Some(settings(
            &[],
            &[("core:files:delete_path", ToolState::Off)],
        )));
        assert!(ensure_file_tool_allowed(&config, Some(&file_tool_off), "delete_path").is_ok());
        let files_off = profile(Some(settings(&[("core:files", false)], &[])));
        assert!(ensure_file_tool_allowed(&config, Some(&files_off), "read_file").is_err());
        // a profile chat without its profile is refused
        assert!(ensure_web_tool_allowed(&profile_context(), "web_search", &config, None).is_err());
    }

    #[test]
    fn a_tool_switched_off_in_the_catalog_is_refused_to_profiles_and_commands() {
        let config = json!({
            "llm": { "tasks": { "chat": { "isWebSearchEnabled": true } } },
            "tools": {
                "sources": { "core:files": { "isEnabled": false } },
                "tools": { "core:web:web_fetch": { "isEnabled": false } }
            },
            "commands": [{ "id": "web", "operationId": "core.aiTask",
              "operationConfig": { "tools": [{ "sourceKind": "core", "sourceId": "web" }] } }]
        });
        let profile = profile(None);
        let command = ToolCallContext::AiCommand {
            command_id: "web".into(),
        };
        // "Ask AI" follows its own web switch only
        assert!(
            ensure_web_tool_allowed(&ToolCallContext::AskAi, "web_fetch", &config, None).is_ok()
        );
        for (context, profile) in [(profile_context(), Some(&profile)), (command, None)] {
            assert!(ensure_web_tool_allowed(&context, "web_fetch", &config, profile).is_err());
            assert!(ensure_web_tool_allowed(&context, "web_search", &config, profile).is_ok());
        }
        assert!(ensure_file_tool_allowed(&config, Some(&profile), "read_file").is_err());
        assert!(ensure_file_tool_allowed(&config, None, "read_file").is_err());
        assert!(ensure_file_tool_allowed(&json!({}), None, "read_file").is_ok());
    }

    #[test]
    fn an_ai_command_has_its_whitelist_only() {
        let config = json!({ "commands": [
            { "id": "whole", "operationId": "core.aiTask",
              "operationConfig": { "tools": [{ "sourceKind": "core", "sourceId": "web" }] } },
            { "id": "search", "operationId": "core.aiTask",
              "operationConfig": { "tools": [
                { "sourceKind": "core", "sourceId": "web", "toolName": "web_search" }] } },
            { "id": "none", "operationId": "core.aiTask", "operationConfig": { "tools": [] } },
            { "id": "script", "operationId": "core.script",
              "operationConfig": { "tools": [{ "sourceKind": "core", "sourceId": "web" }] } }
        ]});
        let command = |id: &str| ToolCallContext::AiCommand {
            command_id: id.into(),
        };
        assert!(ensure_web_tool_allowed(&command("whole"), "web_fetch", &config, None).is_ok());
        assert!(ensure_web_tool_allowed(&command("search"), "web_search", &config, None).is_ok());
        assert!(ensure_web_tool_allowed(&command("search"), "web_fetch", &config, None).is_err());
        assert!(ensure_web_tool_allowed(&command("none"), "web_search", &config, None).is_err());
        assert!(ensure_web_tool_allowed(&command("script"), "web_search", &config, None).is_err());
        assert!(ensure_web_tool_allowed(&command("missing"), "web_search", &config, None).is_err());
    }

    #[test]
    fn no_tool_command_changes_settings_or_permissions() {
        const CHANGING: &[&str] = &[
            "update_user_config",
            "save_ai_profile",
            "update_ai_profile",
            "create_ai_profile",
            "delete_ai_profile",
            "save_ai_project",
            "update_ai_project",
            "delete_ai_project",
            "save_ai_profile_soul",
        ];
        for command in TOOL_COMMANDS {
            assert!(
                command.starts_with("list_ai_")
                    || command.starts_with("run_ai_")
                    || command.starts_with("preview_ai_")
                    || command.starts_with("read_ai_")
                    || command.starts_with("cancel_ai_")
                    || command.starts_with("peek_ai_")
                    || command.starts_with("search_ai_")
                    || command.ends_with("_ai_profile_memory")
                    || command.ends_with("_ai_profile_memory_fact"),
                "{command} is not a tool command"
            );
            assert!(!CHANGING.contains(command));
        }
    }
}
