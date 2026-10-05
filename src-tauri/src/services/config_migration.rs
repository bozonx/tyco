//! Versioned migrations of the user config. A config without `configVersion`
//! is version 0. Each step brings the config one version up; a config newer
//! than this build is left untouched and never written over.

use serde_json::{json, Map, Value};

/// The schema version this build writes. Keep in sync with `CONFIG_VERSION`
/// in `packages/shared/src/user-config.ts`.
pub const CONFIG_VERSION: u64 = 2;

pub const CONFIG_VERSION_KEY: &str = "configVersion";

/// The schema version of `user_config`; 0 when it has none.
pub fn config_version(user_config: &Value) -> u64 {
    user_config
        .get(CONFIG_VERSION_KEY)
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

/// A config written by a newer build: this one must not write over it.
pub fn is_newer_than_supported(user_config: &Value) -> bool {
    config_version(user_config) > CONFIG_VERSION
}

/// Brings `user_config` up to `CONFIG_VERSION`. Returns whether it changed;
/// a config at the current version or newer is left as it is.
pub fn migrate(user_config: &mut Value) -> bool {
    let from = config_version(user_config);
    if from >= CONFIG_VERSION || !user_config.is_object() {
        return false;
    }
    if from < 1 {
        move_custom_actions_to_commands(user_config);
    }
    // version 2 changes nothing here: the default commands and the menu items
    // of plugin tools are added by the webview, the only one that knows the
    // plugin tools. The version still goes up: a build of version 1 knows
    // neither the core and plugin tools nor the `replaceSelection` and `copy`
    // outputs, and would drop the plugin items of the menu on save
    stamp_current_version(user_config);
    true
}

/// Sets `configVersion` to the current one, unless it is there already.
pub fn stamp_current_version(user_config: &mut Value) -> bool {
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    if config.get(CONFIG_VERSION_KEY).and_then(Value::as_u64) == Some(CONFIG_VERSION) {
        return false;
    }
    config.insert(String::from(CONFIG_VERSION_KEY), json!(CONFIG_VERSION));
    true
}

/// Version 1: the script and webhook actions of the action menu become
/// commands of the command library, and the menu refers to them by id. The id
/// is kept, so the webhook secret stays under the same key.
fn move_custom_actions_to_commands(user_config: &mut Value) {
    let Some(config) = user_config.as_object_mut() else {
        return;
    };
    let mut commands: Vec<Value> = config
        .get("commands")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let Some(slots) = config.get_mut("mainActions").and_then(Value::as_array_mut) else {
        config.insert(String::from("commands"), Value::Array(commands));
        return;
    };

    for slot in slots.iter_mut() {
        let Some(action) = slot.as_object() else {
            continue;
        };
        let Some(kind) = action.get("type").and_then(Value::as_str) else {
            continue;
        };
        if kind != "script" && kind != "webhook" {
            continue;
        }
        let id = action
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        // an action without an id could not run before either
        if id.is_empty() {
            *slot = Value::Null;
            continue;
        }
        let id = id.to_owned();
        let known = commands
            .iter()
            .any(|command| command.get("id").and_then(Value::as_str) == Some(id.as_str()));
        if !known {
            commands.push(command_from_action(kind, &id, action));
        }
        *slot = json!({ "type": "command", "commandId": id });
    }

    config.insert(String::from("commands"), Value::Array(commands));
}

fn string_field(action: &Map<String, Value>, key: &str) -> Value {
    Value::String(
        action
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    )
}

fn command_from_action(kind: &str, id: &str, action: &Map<String, Value>) -> Value {
    let tool_config = if kind == "script" {
        json!({
            "command": string_field(action, "command"),
            "workingDir": string_field(action, "workingDir"),
            "takesText": true,
        })
    } else {
        let method = if action.get("method").and_then(Value::as_str) == Some("GET") {
            "GET"
        } else {
            "POST"
        };
        let headers: Map<String, Value> = action
            .get("headers")
            .and_then(Value::as_object)
            .map(|headers| {
                headers
                    .iter()
                    .filter(|(_, value)| value.is_string())
                    .map(|(name, value)| (name.clone(), value.clone()))
                    .collect()
            })
            .unwrap_or_default();
        json!({
            "url": string_field(action, "url"),
            "method": method,
            "headers": headers,
            "payloadTemplate": string_field(action, "payloadTemplate"),
            "authSecret": action.get("authSecret").and_then(Value::as_bool).unwrap_or(false),
            "takesText": true,
        })
    };
    let after_run = if action.get("afterRun").and_then(Value::as_str) == Some("showMenu") {
        "showMenu"
    } else {
        "none"
    };

    // the action keeps behaving in the menu as it did, and stays out of the
    // other places until the user puts it there
    json!({
        "id": id,
        "name": string_field(action, "name"),
        "phrases": [],
        "toolId": kind,
        "toolConfig": tool_config,
        "llmArgumentParsing": false,
        "afterRun": after_run,
        "logOutput": action.get("logOutput").and_then(Value::as_bool).unwrap_or(false),
        "confirm": "auto",
        "availableIn": { "launcher": false, "external": false, "chat": false },
        "enabled": true,
    })
}

/// The name of the copy kept of a config before it is migrated from `version`.
pub fn backup_file_name(config_file_name: &str, version: u64) -> String {
    let stem = config_file_name
        .rsplit_once('.')
        .map_or(config_file_name, |(stem, _)| stem);
    format!("{stem}.v{version}.bak")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_config() -> Value {
        json!({
            "mainActions": [
                { "type": "standard", "actionId": "insertIntoWindow" },
                null,
                {
                    "type": "script",
                    "id": "sc1",
                    "name": "Echo",
                    "command": "echo {{TEXT}}",
                    "workingDir": "~/work",
                    "afterRun": "showMenu",
                    "logOutput": true
                },
                {
                    "type": "webhook",
                    "id": "wh1",
                    "name": "Hook",
                    "url": "https://example.com/hook",
                    "method": "GET",
                    "headers": { "x-a": "1", "x-b": 2 },
                    "authSecret": true
                },
                { "type": "script", "id": " ", "command": "no id" },
                { "type": "plugin", "actionId": "Search:search" }
            ]
        })
    }

    #[test]
    fn a_config_without_a_version_is_version_zero() {
        assert_eq!(config_version(&json!({})), 0);
        assert_eq!(config_version(&json!({ "configVersion": 3 })), 3);
    }

    #[test]
    fn moves_scripts_and_webhooks_into_the_command_library() {
        let mut config = legacy_config();
        assert!(migrate(&mut config));

        assert_eq!(config["configVersion"], json!(CONFIG_VERSION));
        assert_eq!(
            config["mainActions"],
            json!([
                { "type": "standard", "actionId": "insertIntoWindow" },
                null,
                { "type": "command", "commandId": "sc1" },
                { "type": "command", "commandId": "wh1" },
                null,
                { "type": "plugin", "actionId": "Search:search" }
            ])
        );
        assert_eq!(
            config["commands"],
            json!([
                {
                    "id": "sc1",
                    "name": "Echo",
                    "phrases": [],
                    "toolId": "script",
                    "toolConfig": {
                        "command": "echo {{TEXT}}",
                        "workingDir": "~/work",
                        "takesText": true
                    },
                    "llmArgumentParsing": false,
                    "afterRun": "showMenu",
                    "logOutput": true,
                    "confirm": "auto",
                    "availableIn": { "launcher": false, "external": false, "chat": false },
                    "enabled": true
                },
                {
                    "id": "wh1",
                    "name": "Hook",
                    "phrases": [],
                    "toolId": "webhook",
                    "toolConfig": {
                        "url": "https://example.com/hook",
                        "method": "GET",
                        "headers": { "x-a": "1" },
                        "payloadTemplate": "",
                        "authSecret": true,
                        "takesText": true
                    },
                    "llmArgumentParsing": false,
                    "afterRun": "none",
                    "logOutput": false,
                    "confirm": "auto",
                    "availableIn": { "launcher": false, "external": false, "chat": false },
                    "enabled": true
                }
            ])
        );
    }

    #[test]
    fn migrating_twice_changes_nothing() {
        let mut config = legacy_config();
        migrate(&mut config);
        let migrated = config.clone();
        assert!(!migrate(&mut config));
        assert_eq!(config, migrated);
    }

    #[test]
    fn keeps_a_command_that_already_has_the_id() {
        let mut config = json!({
            "mainActions": [{ "type": "script", "id": "sc1", "command": "new" }],
            "commands": [{ "id": "sc1", "name": "Kept" }]
        });
        migrate(&mut config);
        assert_eq!(config["commands"], json!([{ "id": "sc1", "name": "Kept" }]));
        assert_eq!(
            config["mainActions"],
            json!([{ "type": "command", "commandId": "sc1" }])
        );
    }

    #[test]
    fn adds_an_empty_library_to_a_config_without_actions() {
        let mut config = json!({ "theme": "dark" });
        assert!(migrate(&mut config));
        assert_eq!(config["commands"], json!([]));
        assert_eq!(config["configVersion"], json!(CONFIG_VERSION));
    }

    #[test]
    fn leaves_a_newer_config_untouched() {
        let mut config = json!({
            "configVersion": CONFIG_VERSION + 1,
            "mainActions": [{ "type": "script", "id": "sc1" }]
        });
        let original = config.clone();
        assert!(is_newer_than_supported(&config));
        assert!(!migrate(&mut config));
        assert_eq!(config, original);
    }

    #[test]
    fn version_two_only_raises_the_version() {
        let mut config = json!({
            "configVersion": 1,
            "commands": [{ "id": "a", "toolId": "script" }],
            "mainActions": [{ "type": "plugin", "actionId": "FastNote:fastNote" }]
        });
        let before = config.clone();
        assert!(migrate(&mut config));
        assert_eq!(config["configVersion"], json!(2));
        config["configVersion"] = json!(1);
        assert_eq!(config, before);
    }

    #[test]
    fn names_the_backup_after_the_old_version() {
        assert_eq!(backup_file_name("userConfig.yaml", 0), "userConfig.v0.bak");
        assert_eq!(backup_file_name("config", 2), "config.v2.bak");
    }
}
