//! Typed views of the parts of the user config the backend reads. The config
//! stays a `Value` for storage and three-way merges; a reader takes the
//! section it needs through these types instead of indexing it by key. A
//! section that does not fit reads as its default: the schema has checked
//! the config already, so that happens only for a config Tyco repairs.
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

/// The section of `config` under `key`, or its default.
fn section<T: DeserializeOwned + Default>(config: &Value, key: &str) -> T {
    config
        .get(key)
        .and_then(|value| T::deserialize(value).ok())
        .unwrap_or_default()
}

/// What the command overlay takes as its input, `launcherPages[].inputMode`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LauncherInputMode {
    #[default]
    Selection,
    None,
}

/// A page of the command overlay, `launcherPages[]`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LauncherPageConfig {
    pub id: String,
    #[serde(default)]
    pub input_mode: LauncherInputMode,
    /// Empty when the page has no hotkey.
    #[serde(default)]
    pub hotkey: String,
}

/// The pages in their order; one that does not fit is left out, the others
/// stay.
pub fn launcher_pages(config: &Value) -> Vec<LauncherPageConfig> {
    config
        .get("launcherPages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|page| LauncherPageConfig::deserialize(page).ok())
        .collect()
}

/// `externalAccess`: what calls from outside the app may use.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAccessConfig {
    #[serde(default)]
    pub can_access_selection: bool,
}

pub fn external_access(config: &Value) -> ExternalAccessConfig {
    section(config, "externalAccess")
}

/// `aiVault`: where the AI profiles and projects live.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiVaultConfig {
    /// The vault folder the user chose; empty for the app data folder.
    #[serde(default)]
    pub path: String,
}

pub fn ai_vault(config: &Value) -> AiVaultConfig {
    section(config, "aiVault")
}

/// `toolConfig` of a command of the `script` tool.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptToolConfig {
    #[serde(default)]
    pub command: String,
    /// Empty for the home directory.
    #[serde(default)]
    pub working_directory: String,
    #[serde(default)]
    pub timeout_sec: Option<u64>,
}

/// A saved command of the `script` tool, as a run takes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScriptCommand {
    /// The name the action log shows, never empty; see `commandLabel` in
    /// `lib/commands/command-runtime.ts`.
    pub label: String,
    pub tool_config: ScriptToolConfig,
}

/// The saved command `id` when it runs a script. The webview names a command
/// to run instead of passing the shell command itself: a script in the
/// webview must not be able to run a command the user never saved.
pub fn script_command(config: &Value, id: &str) -> Option<ScriptCommand> {
    let command = config
        .get("commands")?
        .as_array()?
        .iter()
        .find(|command| command["id"] == id)?;
    if command["toolId"] != "script" {
        return None;
    }
    let tool_config = ScriptToolConfig::deserialize(&command["toolConfig"]).ok()?;
    let name = command["name"].as_str().map(str::trim).unwrap_or_default();
    let label = if !name.is_empty() {
        name.to_owned()
    } else if !tool_config.command.trim().is_empty() {
        tool_config.command.trim().to_owned()
    } else {
        String::from("Command")
    };
    Some(ScriptCommand { label, tool_config })
}

/// Whether holding the voice hotkey records until released (Push-to-Talk).
pub fn is_voice_hold_enabled(config: &Value) -> bool {
    config
        .get("stt")
        .and_then(|stt| stt.get("isVoiceHoldEnabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn script_commands_are_found_by_id_with_their_label() {
        let config = json!({"commands": [
            {"id": "a", "name": " Notes ", "toolId": "script",
             "toolConfig": {"command": "echo {{TEXT}}", "workingDirectory": "~/n", "timeoutSec": 5}},
            {"id": "b", "name": "", "toolId": "script", "toolConfig": {"command": " ls "}},
            {"id": "c", "name": "Hook", "toolId": "webhook", "toolConfig": {"url": "x"}},
        ]});
        let a = script_command(&config, "a").unwrap();
        assert_eq!(a.label, "Notes");
        assert_eq!(a.tool_config.command, "echo {{TEXT}}");
        assert_eq!(a.tool_config.working_directory, "~/n");
        assert_eq!(a.tool_config.timeout_sec, Some(5));
        assert_eq!(script_command(&config, "b").unwrap().label, "ls");
        assert!(script_command(&config, "c").is_none());
        assert!(script_command(&config, "missing").is_none());
    }

    #[test]
    fn sections_read_their_fields_and_fall_back_to_defaults() {
        let config = json!({
            "launcherPages": [
                {"id": "main", "inputMode": "none", "hotkey": "Ctrl+Alt+M", "slots": []},
                {"id": "second", "inputMode": "selection", "hotkey": "", "slots": []},
            ],
            "externalAccess": {"canAccessSelection": true},
            "aiVault": {"path": "/vault"},
        });
        let pages = launcher_pages(&config);
        assert_eq!(pages[0].input_mode, LauncherInputMode::None);
        assert_eq!(pages[0].hotkey, "Ctrl+Alt+M");
        assert_eq!(pages[1].input_mode, LauncherInputMode::Selection);
        assert!(external_access(&config).can_access_selection);
        assert_eq!(ai_vault(&config).path, "/vault");

        let partly = json!({"launcherPages": [{"hotkey": "x"}, {"id": "kept"}]});
        assert_eq!(launcher_pages(&partly).len(), 1);
        let broken = json!({"launcherPages": "pages", "externalAccess": 1});
        assert!(launcher_pages(&broken).is_empty());
        assert!(!external_access(&broken).can_access_selection);
        assert_eq!(ai_vault(&json!({})), AiVaultConfig::default());
        assert!(!is_voice_hold_enabled(&json!({})));
        assert!(is_voice_hold_enabled(&json!({
            "stt": { "isVoiceHoldEnabled": true }
        })));
    }
}
