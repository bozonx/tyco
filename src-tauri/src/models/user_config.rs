//! Typed views of the parts of the user config the backend reads. The config
//! stays a `Value` for storage and three-way merges; a reader takes the
//! section it needs through these types instead of indexing it by key. A
//! section that does not fit reads as its default: the schema has checked
//! the config already, so that happens only for a config Tyco repairs.
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
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
    /// New entries live in the memory of the process only; the stored ones
    /// stay on disk as they are.
    Session,
    #[default]
    #[serde(other)]
    Disk,
}

/// `chat.history`: the chats of "Ask AI" and of every profile whose
/// workspace sets nothing of its own.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub storage: HistoryStorage,
    /// 0 keeps the chats forever.
    #[serde(default, deserialize_with = "lenient")]
    pub retention_days: u64,
    /// Quick requests are saved with the chats; `None` when missing.
    #[serde(default, deserialize_with = "lenient")]
    pub is_quick_request_saving_enabled: Option<bool>,
}

/// The history of the chats, see `ChatHistoryConfig`.
pub fn chat_history(config: &Value) -> ChatHistoryConfig {
    section_at(config, "/chat/history")
}

/// Whether the "Ask AI" chat may search and read the web:
/// `llm.tasks.chat.isWebSearchEnabled`, on when unset.
pub fn is_ask_ai_web_search_enabled(config: &Value) -> bool {
    config
        .pointer("/llm/tasks/chat/isWebSearchEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

/// The tool whitelist of the AI command `command_id`, as stored; empty when
/// there is no such AI command.
pub fn ai_command_tools(config: &Value, command_id: &str) -> Vec<Value> {
    config
        .get("commands")
        .and_then(Value::as_array)
        .and_then(|commands| {
            commands.iter().find(|command| {
                command.get("id").and_then(Value::as_str) == Some(command_id)
                    && command.get("operationId").and_then(Value::as_str) == Some("core.aiTask")
            })
        })
        .and_then(|command| command.pointer("/operationConfig/tools"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// `editor.history`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub storage: HistoryStorage,
    /// 0 keeps the entries forever.
    #[serde(default, deserialize_with = "lenient")]
    pub retention_days: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub is_secret_sanitizing_enabled: bool,
}

pub fn editor_history(config: &Value) -> EditorHistoryConfig {
    section_at(config, "/editor/history")
}

fn yes() -> bool {
    true
}

/// How `dialog` records a call to a file.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DialogRecordingConfig {
    /// `isRecordingMixedDown`: both sides in one mono channel rather than
    /// the microphone left and the computer sound right.
    #[serde(rename = "isRecordingMixedDown", default)]
    pub is_mixed_down: bool,
    /// `isRecordingProcessed`: the sound as the speech recognition gets it,
    /// the echo lowered and the peaks limited, rather than as captured.
    #[serde(rename = "isRecordingProcessed", default = "yes")]
    pub is_processed: bool,
}

impl Default for DialogRecordingConfig {
    fn default() -> Self {
        Self {
            is_mixed_down: false,
            is_processed: true,
        }
    }
}

/// `dialog.history`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DialogHistoryConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub storage: HistoryStorage,
    /// 0 keeps the dialogs forever.
    #[serde(default, deserialize_with = "lenient")]
    pub retention_days: u64,
}

/// The history of the dialog sessions.
pub fn dialog_history(config: &Value) -> DialogHistoryConfig {
    section_at(config, "/dialog/history")
}

/// The recording options of `dialog`.
pub fn dialog_recording(config: &Value) -> DialogRecordingConfig {
    section(config, "dialog")
}

#[cfg(any(target_os = "linux", test))]
/// `windowInsertion.linux.pasteShortcut`: the keys that paste into the
/// target window. A fixed combination is pressed as it is in every window,
/// terminals included; `Auto` picks one by the kind of the window.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
pub enum PasteShortcut {
    /// Ctrl+V, and Ctrl+Shift+V in a terminal.
    #[default]
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "Ctrl+V")]
    CtrlV,
    #[serde(rename = "Ctrl+Shift+V")]
    CtrlShiftV,
    #[serde(rename = "Shift+Insert")]
    ShiftInsert,
}

#[cfg(any(target_os = "linux", test))]
/// A key combination that pastes, `PasteShortcut` resolved for one window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PasteKeys {
    CtrlV,
    CtrlShiftV,
    ShiftInsert,
}

#[cfg(any(target_os = "linux", test))]
/// `windowInsertion.linux`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinuxInsertionConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub paste_shortcut: PasteShortcut,
}

#[cfg(any(target_os = "linux", test))]
impl LinuxInsertionConfig {
    /// The keys that paste into a terminal or into another window.
    pub fn paste_keys_for(&self, is_terminal: bool) -> PasteKeys {
        match self.paste_shortcut {
            PasteShortcut::Auto if is_terminal => PasteKeys::CtrlShiftV,
            PasteShortcut::Auto | PasteShortcut::CtrlV => PasteKeys::CtrlV,
            PasteShortcut::CtrlShiftV => PasteKeys::CtrlShiftV,
            PasteShortcut::ShiftInsert => PasteKeys::ShiftInsert,
        }
    }
}

#[cfg(any(target_os = "linux", test))]
pub fn linux_insertion(config: &Value) -> LinuxInsertionConfig {
    section_at(config, "/windowInsertion/linux")
}

/// What an action page takes as its input, `actionPages[].inputMode`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActionInputMode {
    #[default]
    Selection,
    None,
}

/// A page of the action menu, `actionPages[]`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionPageConfig {
    #[serde(default)]
    pub input_mode: ActionInputMode,
}

/// The action pages in their order.
pub fn action_pages(config: &Value) -> Vec<ActionPageConfig> {
    config
        .get("actionPages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|page| ActionPageConfig::deserialize(page).ok())
        .collect()
}

fn default_true() -> bool {
    true
}

/// A custom action slot, `customActionSlots[]`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomActionSlotConfig {
    #[serde(default = "default_true")]
    pub takes_selection: bool,
}

/// The custom action slots in their order.
pub fn custom_action_slots(config: &Value) -> Vec<CustomActionSlotConfig> {
    config
        .get("customActionSlots")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|slot| CustomActionSlotConfig::deserialize(slot).ok())
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

/// A workspace this device attached besides the main one, `aiVaults.attached`.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachedWorkspace {
    #[serde(default)]
    pub path: String,
    /// The id of its marker when it was attached, known while it is away.
    #[serde(default)]
    #[serde(rename = "vaultId")]
    pub workspace_id: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct AiWorkspacesConfig {
    #[serde(default)]
    attached: Vec<AttachedWorkspace>,
}

/// The workspaces this device attached; entries without a path are skipped.
pub fn attached_workspaces(config: &Value) -> Vec<AttachedWorkspace> {
    section::<AiWorkspacesConfig>(config, "aiVaults")
        .attached
        .into_iter()
        .filter(|workspace| !workspace.path.trim().is_empty())
        .collect()
}

/// `operationConfig` of a command of the `script` tool.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptOperationConfig {
    #[serde(default)]
    pub command: String,
    /// Empty for the home directory.
    #[serde(default)]
    pub working_directory: String,
    /// Started on its own and not waited for, see `ScriptRequest::is_detached`.
    #[serde(default)]
    pub is_detached: bool,
}

/// A saved command of the `script` tool, as a run takes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScriptCommand {
    /// The name the action log shows, never empty; see `commandLabel` in
    /// `lib/commands/command-runtime.ts`.
    pub label: String,
    pub operation_config: ScriptOperationConfig,
    pub is_enabled: bool,
    /// Whether it runs on the platform of this build, see
    /// [`CommandConfig::platforms`].
    pub is_on_this_platform: bool,
}

/// A saved command, `commands[]`. Its `operationConfig` depends on the tool and
/// stays a `Value`.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub id: String,
    #[serde(default, deserialize_with = "lenient")]
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub operation_id: String,
    /// Missing counts as enabled, as the schema default does; see
    /// `is_enabled` in `services/external/command_library.rs`.
    #[serde(default = "default_true", deserialize_with = "lenient_enabled")]
    pub is_enabled: bool,
    #[serde(default)]
    pub operation_config: Value,
    /// The platforms the command runs on, empty for every one. On another
    /// one it stays in the config and in the grids, but does not run.
    #[serde(default, deserialize_with = "lenient_platforms")]
    pub platforms: Vec<String>,
}

impl CommandConfig {
    /// Whether the command runs on the platform of this build.
    pub fn is_on_this_platform(&self) -> bool {
        is_on_this_platform(&self.platforms)
    }
}

/// Whether `platforms` of a command, empty for every one, take the platform
/// of this build.
pub fn is_on_this_platform(platforms: &[String]) -> bool {
    platforms.is_empty()
        || platforms
            .iter()
            .any(|platform| platform == crate::services::platform::hotkeys::platform_name())
}

/// The platforms of a command as the schema repair keeps them: the known
/// names only, so one bad entry does not widen the command to every platform.
pub fn platforms_from(value: &Value) -> Vec<String> {
    let mut platforms: Vec<String> = Vec::new();
    for platform in value.as_array().into_iter().flatten() {
        if let Some(name) = platform
            .as_str()
            .filter(|name| KNOWN_PLATFORMS.contains(name))
        {
            if !platforms.iter().any(|known| known == name) {
                platforms.push(name.to_owned());
            }
        }
    }
    platforms
}

/// See `COMMAND_PLATFORMS` in `commands-config.ts`.
const KNOWN_PLATFORMS: [&str; 2] = ["linux", "windows"];

fn lenient_platforms<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(platforms_from(&Value::deserialize(deserializer)?))
}

/// See `COMMAND_RUN_TIMEOUT_DEFAULT_SEC` in `commands-config.ts`.
pub const DEFAULT_COMMAND_RUN_TIMEOUT_SEC: u64 = 300;
/// See `COMMAND_RUN_TIMEOUT_MAX_SEC` in `commands-config.ts`.
pub const MAX_COMMAND_RUN_TIMEOUT_SEC: u64 = 3600;

/// The run limit of commands from `commandRunTimeoutSec`: `None` if 0 (unbounded),
/// or `Some(Duration)` bounded by `MAX_COMMAND_RUN_TIMEOUT_SEC`.
pub fn command_run_limit(config: &Value) -> Option<std::time::Duration> {
    let seconds = config
        .get("commandRunTimeoutSec")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_COMMAND_RUN_TIMEOUT_SEC);
    if seconds == 0 {
        None
    } else {
        Some(std::time::Duration::from_secs(
            seconds.min(MAX_COMMAND_RUN_TIMEOUT_SEC),
        ))
    }
}

/// Only an explicit `false` disables a command, see `CommandConfig::is_enabled`.
fn lenient_enabled<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Value::deserialize(deserializer)?.as_bool() != Some(false))
}

/// The longest shell command shown in place of a name, see
/// `SCRIPT_LABEL_MAX_CHARS` in `lib/commands/command-runtime.ts`.
const SCRIPT_LABEL_MAX_CHARS: usize = 60;

/// The first line of a shell command, cut short, as `shortScriptLabel` in
/// `lib/commands/command-runtime.ts` makes it.
fn short_script_label(script: &str) -> String {
    let script = script.trim();
    let line = script.lines().next().unwrap_or_default().trim();
    let is_cut = line.chars().count() > SCRIPT_LABEL_MAX_CHARS || line != script;
    if is_cut {
        let cut: String = line.chars().take(SCRIPT_LABEL_MAX_CHARS).collect();
        format!("{}…", cut.trim_end())
    } else {
        line.to_owned()
    }
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
    let command = command(config, id).filter(|command| command.operation_id == "script")?;
    let operation_config = ScriptOperationConfig::deserialize(&command.operation_config).ok()?;
    let name = command.name.trim();
    let label = if !name.is_empty() {
        name.to_owned()
    } else if !operation_config.command.trim().is_empty() {
        short_script_label(&operation_config.command)
    } else {
        String::from("Command")
    };
    Some(ScriptCommand {
        label,
        operation_config,
        is_enabled: command.is_enabled,
        is_on_this_platform: command.is_on_this_platform(),
    })
}

#[cfg(test)]
mod command_tests {
    use super::*;

    #[test]
    fn a_command_without_is_enabled_is_enabled() {
        let config = serde_json::json!({"commands": [
            {"id": "a", "operationId": "script"},
            {"id": "b", "operationId": "script", "isEnabled": false},
            {"id": "c", "operationId": "script", "isEnabled": "no"},
        ]});
        assert!(command(&config, "a").unwrap().is_enabled);
        assert!(!command(&config, "b").unwrap().is_enabled);
        assert!(command(&config, "c").unwrap().is_enabled);
    }

    #[test]
    fn a_script_label_is_its_first_line_cut_short() {
        assert_eq!(short_script_label("  echo hi  "), "echo hi");
        assert_eq!(short_script_label("echo a\necho b"), "echo a…");
        let long = "x".repeat(70);
        assert_eq!(short_script_label(&long), format!("{}…", "x".repeat(60)));
    }
}

/// Whether holding the voice input hotkey records until released (Push-to-Talk).
pub fn is_voice_input_hold_enabled(config: &Value) -> bool {
    section_at::<SttConfig>(config, "/stt").is_voice_input_hold_enabled
}

/// Whether holding the voice commands hotkey records until released (Push-to-Talk).
pub fn is_voice_commands_hold_enabled(config: &Value) -> bool {
    section_at::<SttConfig>(config, "/stt").is_voice_commands_hold_enabled
}

/// The part of `stt` the backend reads.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SttConfig {
    #[serde(default, deserialize_with = "lenient")]
    is_voice_input_hold_enabled: bool,
    #[serde(default, deserialize_with = "lenient")]
    is_voice_commands_hold_enabled: bool,
}

/// Preferred placement of action sheets on the active output.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActionMenuPosition {
    #[default]
    Center,
    Right,
    BottomRight,
}

pub fn action_menu_position(config: &Value) -> ActionMenuPosition {
    section_at(config, "/quickWindow/actionMenuPosition")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_dialog_is_recorded_stereo_and_processed_unless_told_otherwise() {
        assert_eq!(
            dialog_recording(&json!({})),
            DialogRecordingConfig::default()
        );
        let options = dialog_recording(&json!({"dialog": {
            "isRecordingMixedDown": true, "isRecordingProcessed": false
        }}));
        assert!(options.is_mixed_down && !options.is_processed);
        let options = dialog_recording(&json!({"dialog": {"isRecordingProcessed": false}}));
        assert!(!options.is_mixed_down && !options.is_processed);
    }

    #[test]
    fn script_commands_are_found_by_id_with_their_label() {
        let config = json!({"commands": [
            {"id": "a", "name": " Notes ", "operationId": "script",
             "operationConfig": {"command": "echo {{TEXT}}", "workingDirectory": "~/n"}},
            {"id": "b", "name": "", "operationId": "script", "operationConfig": {"command": " ls "}},
            {"id": "c", "name": "Hook", "operationId": "webhook", "operationConfig": {"url": "x"}},
        ]});
        let a = script_command(&config, "a").unwrap();
        assert_eq!(a.label, "Notes");
        assert_eq!(a.operation_config.command, "echo {{TEXT}}");
        assert_eq!(a.operation_config.working_directory, "~/n");
        assert_eq!(script_command(&config, "b").unwrap().label, "ls");
        assert!(script_command(&config, "c").is_none());
        assert!(script_command(&config, "missing").is_none());
    }

    #[test]
    fn command_run_limit_reads_timeout_or_defaults_or_disables() {
        use std::time::Duration;
        assert_eq!(
            command_run_limit(&json!({"commandRunTimeoutSec": 30})),
            Some(Duration::from_secs(30))
        );
        assert_eq!(command_run_limit(&json!({"commandRunTimeoutSec": 0})), None);
        assert_eq!(
            command_run_limit(&json!({})),
            Some(Duration::from_secs(DEFAULT_COMMAND_RUN_TIMEOUT_SEC))
        );
        assert_eq!(
            command_run_limit(&json!({"commandRunTimeoutSec": 99999})),
            Some(Duration::from_secs(MAX_COMMAND_RUN_TIMEOUT_SEC))
        );
    }

    #[test]
    fn sections_read_their_fields_and_fall_back_to_defaults() {
        let config = json!({
            "actionPages": [
                {"inputMode": "none", "slots": {}},
                {"inputMode": "selection", "slots": {}},
            ],
            "externalAccess": {"canAccessSelection": true},
        });
        let pages = action_pages(&config);
        assert_eq!(pages[0].input_mode, ActionInputMode::None);
        assert_eq!(pages[1].input_mode, ActionInputMode::Selection);
        assert!(external_access(&config).can_access_selection);

        let partly = json!({"actionPages": [{"inputMode": "none"}, {"slots": {}}]});
        assert_eq!(action_pages(&partly).len(), 2);
        let broken = json!({"actionPages": "pages", "externalAccess": 1});
        assert!(action_pages(&broken).is_empty());
        assert!(!external_access(&broken).can_access_selection);
        assert!(!is_voice_input_hold_enabled(&json!({})));
        assert!(is_voice_input_hold_enabled(&json!({
            "stt": { "isVoiceInputHoldEnabled": true }
        })));
        assert!(!is_voice_commands_hold_enabled(&json!({
            "stt": { "isVoiceInputHoldEnabled": true }
        })));
        assert!(is_voice_commands_hold_enabled(&json!({
            "stt": { "isVoiceCommandsHoldEnabled": true }
        })));
    }

    #[test]
    fn history_sections_read_each_field_on_its_own() {
        let config = json!({
            "chat": {"history": {"storage": "session", "retentionDays": "x"}},
            "editor": {"history": {"storage": "session",
                                   "retentionDays": 3, "isSecretSanitizingEnabled": true}},
        });
        assert_eq!(
            chat_history(&config),
            ChatHistoryConfig {
                storage: HistoryStorage::Session,
                retention_days: 0,
                is_quick_request_saving_enabled: None,
            }
        );
        let editor = editor_history(&config);
        assert_eq!(editor.storage, HistoryStorage::Session);
        assert_eq!(editor.retention_days, 3);
        assert!(editor.is_secret_sanitizing_enabled);
        assert_eq!(editor_history(&json!({})), EditorHistoryConfig::default());
    }

    #[test]
    fn auto_paste_tells_terminals_and_fixed_keys_are_pressed_everywhere() {
        let insertion = |shortcut: Value| {
            linux_insertion(&json!({"windowInsertion": {"linux": {"pasteShortcut": shortcut}}}))
        };
        for (setting, other, terminal) in [
            (json!("auto"), PasteKeys::CtrlV, PasteKeys::CtrlShiftV),
            (json!("Ctrl+V"), PasteKeys::CtrlV, PasteKeys::CtrlV),
            (
                json!("Ctrl+Shift+V"),
                PasteKeys::CtrlShiftV,
                PasteKeys::CtrlShiftV,
            ),
            (
                json!("Shift+Insert"),
                PasteKeys::ShiftInsert,
                PasteKeys::ShiftInsert,
            ),
            (json!("bogus"), PasteKeys::CtrlV, PasteKeys::CtrlShiftV),
            (Value::Null, PasteKeys::CtrlV, PasteKeys::CtrlShiftV),
        ] {
            let config = insertion(setting.clone());
            assert_eq!(config.paste_keys_for(false), other, "{setting}");
            assert_eq!(config.paste_keys_for(true), terminal, "{setting}");
        }
        assert_eq!(
            linux_insertion(&json!({})).paste_shortcut,
            PasteShortcut::Auto
        );
    }
}
