//! Typed views of the parts of the user config the backend reads. The config
//! stays a `Value` for storage and three-way merges; a reader takes the
//! section it needs through these types instead of indexing it by key. A
//! section that does not fit reads as its default: the schema has checked
//! the config already, so that happens only for a config Tyco repairs.
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// The section of `config` under `key`, or its default.
fn section<T: DeserializeOwned + Default>(config: &Value, key: &str) -> T {
    config
        .get(key)
        .and_then(|value| T::deserialize(value).ok())
        .unwrap_or_default()
}

/// The section of `config` at the JSON `pointer`, or its default.
fn section_at<T: DeserializeOwned + Default>(config: &Value, pointer: &str) -> T {
    config
        .pointer(pointer)
        .and_then(|value| T::deserialize(value).ok())
        .unwrap_or_default()
}

/// Reads a field that does not fit as its default, so that one broken field
/// leaves the others of its section as they are.
fn lenient<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned + Default,
{
    let value = Value::deserialize(deserializer)?;
    Ok(T::deserialize(value).unwrap_or_default())
}

/// `storage` of a history section; an unknown value keeps the history on disk.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryStorage {
    Off,
    /// The memory of the process only.
    Session,
    #[default]
    #[serde(other)]
    Disk,
}

/// `chat.history` and `aiProfiles.chatHistory`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub storage: HistoryStorage,
    /// 0 keeps the chats forever.
    #[serde(default, deserialize_with = "lenient")]
    pub retention_days: u64,
}

/// The history of the chats of "Ask AI".
pub fn chat_history(config: &Value) -> ChatHistoryConfig {
    section_at(config, "/chat/history")
}

/// The history every profile chat follows.
pub fn profile_chat_history(config: &Value) -> ChatHistoryConfig {
    section_at(config, "/aiProfiles/chatHistory")
}

/// `editor.history`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub storage: HistoryStorage,
    /// `None` when missing or not a count.
    #[serde(default, deserialize_with = "lenient")]
    pub max_items: Option<usize>,
    /// 0 keeps the entries forever.
    #[serde(default, deserialize_with = "lenient")]
    pub retention_days: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub is_secret_sanitizing_enabled: bool,
}

pub fn editor_history(config: &Value) -> EditorHistoryConfig {
    section_at(config, "/editor/history")
}

#[cfg(any(target_os = "linux", test))]
/// A key combination that pastes, `windowInsertion.linux.*PasteShortcut`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
pub enum PasteShortcut {
    #[default]
    #[serde(rename = "Ctrl+V")]
    CtrlV,
    #[serde(rename = "Ctrl+Shift+V")]
    CtrlShiftV,
    #[serde(rename = "Shift+Insert")]
    ShiftInsert,
}

#[cfg(any(target_os = "linux", test))]
/// `windowInsertion.linux.terminalPasteShortcut`: `null` pastes into a
/// terminal as into any other window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalPasteShortcut {
    SameAsOtherWindows,
    Shortcut(PasteShortcut),
}

#[cfg(any(target_os = "linux", test))]
impl Default for TerminalPasteShortcut {
    fn default() -> Self {
        Self::Shortcut(PasteShortcut::CtrlShiftV)
    }
}

#[cfg(any(target_os = "linux", test))]
impl<'de> Deserialize<'de> for TerminalPasteShortcut {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Value::deserialize(deserializer)? {
            Value::Null => Self::SameAsOtherWindows,
            value => PasteShortcut::deserialize(value)
                .map(Self::Shortcut)
                .unwrap_or_default(),
        })
    }
}

#[cfg(any(target_os = "linux", test))]
/// `windowInsertion.linux`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinuxInsertionConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub paste_shortcut: PasteShortcut,
    #[serde(default)]
    pub terminal_paste_shortcut: TerminalPasteShortcut,
}

#[cfg(any(target_os = "linux", test))]
impl LinuxInsertionConfig {
    /// The keys that paste into a terminal or into another window.
    pub fn paste_shortcut_for(&self, is_terminal: bool) -> PasteShortcut {
        match self.terminal_paste_shortcut {
            TerminalPasteShortcut::Shortcut(shortcut) if is_terminal => shortcut,
            _ => self.paste_shortcut,
        }
    }
}

#[cfg(any(target_os = "linux", test))]
pub fn linux_insertion(config: &Value) -> LinuxInsertionConfig {
    section_at(config, "/windowInsertion/linux")
}

/// `isInDevelopment`: a development build that keeps no editor history.
pub fn is_in_development(config: &Value) -> bool {
    config
        .get("isInDevelopment")
        .and_then(Value::as_bool)
        .unwrap_or(false)
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

/// A saved command, `commands[]`. Its `toolConfig` depends on the tool and
/// stays a `Value`.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub id: String,
    #[serde(default, deserialize_with = "lenient")]
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub tool_id: String,
    #[serde(default, deserialize_with = "lenient")]
    pub is_enabled: bool,
    #[serde(default)]
    pub tool_config: Value,
}

/// The saved commands in their order; one that is not an object is left out.
pub fn commands(config: &Value) -> Vec<CommandConfig> {
    config
        .get("commands")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|command| CommandConfig::deserialize(command).ok())
        .collect()
}

/// The saved command `id`.
pub fn command(config: &Value, id: &str) -> Option<CommandConfig> {
    commands(config)
        .into_iter()
        .find(|command| command.id == id)
}

/// The saved command `id` when it runs a script. The webview names a command
/// to run instead of passing the shell command itself: a script in the
/// webview must not be able to run a command the user never saved.
pub fn script_command(config: &Value, id: &str) -> Option<ScriptCommand> {
    let command = command(config, id).filter(|command| command.tool_id == "script")?;
    let tool_config = ScriptToolConfig::deserialize(&command.tool_config).ok()?;
    let name = command.name.trim();
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
    section_at::<SttConfig>(config, "/stt").is_voice_hold_enabled
}

/// The part of `stt` the backend reads.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SttConfig {
    #[serde(default, deserialize_with = "lenient")]
    is_voice_hold_enabled: bool,
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

    #[test]
    fn history_sections_read_each_field_on_its_own() {
        let config = json!({
            "chat": {"history": {"storage": "off", "retentionDays": 7}},
            "aiProfiles": {"chatHistory": {"storage": "bogus", "retentionDays": "x"}},
            "editor": {"history": {"storage": "session", "maxItems": " 7 ",
                                   "retentionDays": 3, "isSecretSanitizingEnabled": true}},
        });
        assert_eq!(
            chat_history(&config),
            ChatHistoryConfig {
                storage: HistoryStorage::Off,
                retention_days: 7
            }
        );
        assert_eq!(profile_chat_history(&config), ChatHistoryConfig::default());
        let editor = editor_history(&config);
        assert_eq!(editor.storage, HistoryStorage::Session);
        assert_eq!(editor.max_items, None);
        assert_eq!(editor.retention_days, 3);
        assert!(editor.is_secret_sanitizing_enabled);
        assert_eq!(editor_history(&json!({})), EditorHistoryConfig::default());
        let max_items = |value: Value| {
            editor_history(&json!({"editor": {"history": {"maxItems": value}}})).max_items
        };
        assert_eq!(max_items(json!(0)), Some(0));
        assert_eq!(max_items(json!(5)), Some(5));
        assert_eq!(max_items(json!(-3)), None);
        assert_eq!(max_items(json!("0")), None);
    }

    #[test]
    fn terminal_paste_is_explicit_and_falls_back_per_field() {
        let insertion = |terminal: Value| {
            linux_insertion(&json!({"windowInsertion": {"linux": {
                "pasteShortcut": "Shift+Insert",
                "terminalPasteShortcut": terminal,
            }}}))
        };
        for (setting, expected) in [
            (json!("Ctrl+V"), PasteShortcut::CtrlV),
            (json!("Ctrl+Shift+V"), PasteShortcut::CtrlShiftV),
            (json!("Shift+Insert"), PasteShortcut::ShiftInsert),
            (Value::Null, PasteShortcut::ShiftInsert),
            (json!("invalid"), PasteShortcut::CtrlShiftV),
        ] {
            let config = insertion(setting);
            assert_eq!(config.paste_shortcut_for(true), expected);
            assert_eq!(config.paste_shortcut_for(false), PasteShortcut::ShiftInsert);
        }
        let missing = linux_insertion(&json!({}));
        assert_eq!(missing.paste_shortcut_for(true), PasteShortcut::CtrlShiftV);
        assert_eq!(missing.paste_shortcut_for(false), PasteShortcut::CtrlV);
        let bogus =
            linux_insertion(&json!({"windowInsertion": {"linux": {"pasteShortcut": "bogus"}}}));
        assert_eq!(bogus.paste_shortcut_for(false), PasteShortcut::CtrlV);
    }
}
