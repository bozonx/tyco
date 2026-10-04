//! Commands of the library run from outside the app: D-Bus `RunCommand` and
//! `tyco-ctl run`. The command is found here, from the config the backend
//! holds, so a wrong id or name is an error of the call itself. The run is
//! handed to the webview of the quick window: in the background when nothing
//! has to be asked or shown, otherwise in the command overlay.
//! See `dev_docs/design-voice-commands.md`, §3.4.

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::runtime;
use crate::state::AppState;

pub const COMMAND_RUN_EVENT: &str = "app://command-run";

/// Tools this build runs; a command of another tool is unavailable.
const KNOWN_TOOLS: [&str; 2] = ["script", "webhook"];

/// A command found for a call, with what decides how it runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalCommand {
    pub id: String,
    pub takes_text: bool,
    pub confirm: bool,
    pub shows_menu: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupError {
    NotFound(String),
    /// Several commands that may be called have this name.
    Ambiguous(String, Vec<String>),
    Disabled(String),
    NotExternal(String),
    /// Its tool is not available in this build.
    Unavailable(String),
}

impl std::fmt::Display for LookupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(target) => write!(f, "No command with the id or name `{target}`"),
            Self::Ambiguous(target, ids) => write!(
                f,
                "Several commands are named `{target}`; call one by its id: {}",
                ids.join(", ")
            ),
            Self::Disabled(id) => write!(f, "The command `{id}` is disabled"),
            Self::NotExternal(id) => write!(
                f,
                "The command `{id}` may not be run from outside; allow it in its settings"
            ),
            Self::Unavailable(id) => write!(f, "The tool of the command `{id}` is not available"),
        }
    }
}

impl From<LookupError> for AppError {
    fn from(error: LookupError) -> Self {
        AppError::Message(error.to_string())
    }
}

/// A name as calls compare it: case, `ё`, and spaces do not matter. Keep in
/// sync with `normalizeCommandName` in `lib/commands/command-config.ts`.
pub fn normalize_name(name: &str) -> String {
    name.to_lowercase()
        .replace('ё', "е")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn commands_of(user_config: &Value) -> &[Value] {
    user_config
        .get("commands")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn str_field<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn id_of(command: &Value) -> &str {
    str_field(command, "id").trim()
}

fn is_known_tool(command: &Value) -> bool {
    KNOWN_TOOLS.contains(&str_field(command, "toolId").trim())
}

fn is_enabled(command: &Value) -> bool {
    command.get("enabled").and_then(Value::as_bool) != Some(false)
}

fn is_external(command: &Value) -> bool {
    command
        .pointer("/availableIn/external")
        .and_then(Value::as_bool)
        == Some(true)
}

fn takes_text(command: &Value) -> bool {
    is_known_tool(command)
        && command
            .pointer("/toolConfig/takesText")
            .and_then(Value::as_bool)
            != Some(false)
}

/// Why the command cannot be called from outside, if it cannot.
fn unavailability(command: &Value) -> Option<LookupError> {
    let id = id_of(command).to_owned();
    if !is_known_tool(command) {
        Some(LookupError::Unavailable(id))
    } else if !is_enabled(command) {
        Some(LookupError::Disabled(id))
    } else if !is_external(command) {
        Some(LookupError::NotExternal(id))
    } else {
        None
    }
}

fn external_command(command: &Value) -> ExternalCommand {
    ExternalCommand {
        id: id_of(command).to_owned(),
        takes_text: takes_text(command),
        confirm: str_field(command, "confirm") == "always",
        shows_menu: str_field(command, "afterRun") == "showMenu",
    }
}

/// The command `target` names: the one with this id, otherwise the only one
/// of the callable commands with this name.
pub fn find(user_config: &Value, target: &str) -> Result<ExternalCommand, LookupError> {
    let commands = commands_of(user_config);
    let target = target.trim();
    let by_id = commands
        .iter()
        .find(|command| !id_of(command).is_empty() && id_of(command) == target);
    let command = match by_id {
        Some(command) => command,
        None => {
            let name = normalize_name(target);
            let named: Vec<&Value> = commands
                .iter()
                .filter(|command| {
                    !name.is_empty() && normalize_name(str_field(command, "name")) == name
                })
                .collect();
            let callable: Vec<&Value> = named
                .iter()
                .copied()
                .filter(|command| unavailability(command).is_none())
                .collect();
            match (callable.as_slice(), named.first()) {
                ([command], _) => *command,
                ([], Some(command)) => *command,
                ([], None) => return Err(LookupError::NotFound(target.to_owned())),
                (several, _) => {
                    return Err(LookupError::Ambiguous(
                        target.to_owned(),
                        several
                            .iter()
                            .map(|command| id_of(command).to_owned())
                            .collect(),
                    ))
                }
            }
        }
    };
    match unavailability(command) {
        Some(error) => Err(error),
        None => Ok(external_command(command)),
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ListedCommand {
    id: String,
    name: String,
    /// `text` or `none`
    input: &'static str,
}

/// The commands that may be called from outside, as a JSON array of
/// `{ id, name, input }`, in the order of the library.
pub fn list(user_config: &Value) -> String {
    let listed: Vec<ListedCommand> = commands_of(user_config)
        .iter()
        .filter(|command| !id_of(command).is_empty() && unavailability(command).is_none())
        .map(|command| {
            let name = str_field(command, "name").trim();
            ListedCommand {
                id: id_of(command).to_owned(),
                name: if name.is_empty() {
                    id_of(command)
                } else {
                    name
                }
                .to_owned(),
                input: if takes_text(command) { "text" } else { "none" },
            }
        })
        .collect();
    serde_json::to_string(&listed).unwrap_or_else(|_| String::from("[]"))
}

/// A command the overlay opens with, see `Activation::launcher_request`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherRequest {
    pub command_id: String,
    /// The text of the call; without it the selection or the field gives it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// A run in the background, sent to the webview of the quick window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandRunEvent {
    command_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    /// The quick window does not receive config changes made elsewhere.
    user_config: Value,
}

/// How a found command runs.
#[derive(Debug, PartialEq, Eq)]
enum Route {
    /// No window: the outcome goes to the status bubble and notifications.
    Background,
    /// The command overlay: it asks for the text or a confirmation, or shows
    /// the output in the result menu.
    Overlay,
}

fn route(command: &ExternalCommand, text: Option<&str>) -> Route {
    if command.confirm || command.shows_menu || (command.takes_text && text.is_none()) {
        Route::Overlay
    } else {
        Route::Background
    }
}

/// Runs the command `target` names on `text`. Returns once the command is
/// found and handed over; how it went is reported by the webview.
pub fn run(
    app: &AppHandle,
    target: &str,
    text: Option<String>,
    source: ActivationSource,
) -> Result<(), AppError> {
    let user_config = app.state::<AppState>().params().user_config;
    let command = find(&user_config, target)?;
    // a command without input has nothing to do with a text
    let text = text
        .filter(|text| !text.trim().is_empty())
        .filter(|_| command.takes_text);

    match route(&command, text.as_deref()) {
        Route::Overlay => {
            let mut activation = Activation::new(StartMode::CommandLauncher, source);
            activation.launcher_request = Some(LauncherRequest {
                command_id: command.id,
                text,
            });
            runtime::activate(app, activation)
        }
        Route::Background => {
            let window = app
                .get_webview_window(runtime::QUICK_WINDOW_LABEL)
                .ok_or_else(|| AppError::Message(String::from("Quick window not found")))?;
            window
                .emit(
                    COMMAND_RUN_EVENT,
                    CommandRunEvent {
                        command_id: command.id,
                        text,
                        user_config,
                    },
                )
                .map_err(|error| AppError::Message(error.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn config() -> Value {
        json!({
            "commands": [
                {
                    "id": "backup",
                    "name": "Бэкап",
                    "toolId": "script",
                    "toolConfig": { "command": "backup.sh", "takesText": false },
                    "confirm": "always",
                    "availableIn": { "launcher": true, "external": true }
                },
                {
                    "id": "note",
                    "name": "Work  Note",
                    "toolId": "webhook",
                    "toolConfig": { "url": "https://example.com" },
                    "afterRun": "showMenu",
                    "availableIn": { "external": true }
                },
                {
                    "id": "hidden",
                    "name": "Hidden",
                    "toolId": "script",
                    "toolConfig": { "command": "x" },
                    "availableIn": { "external": false }
                },
                {
                    "id": "off",
                    "name": "Off",
                    "toolId": "script",
                    "toolConfig": { "command": "x" },
                    "enabled": false,
                    "availableIn": { "external": true }
                },
                {
                    "id": "plugin",
                    "name": "Plugin",
                    "toolId": "fastNote.write",
                    "availableIn": { "external": true }
                },
                {
                    "id": "twin-a",
                    "name": "Twin",
                    "toolId": "script",
                    "toolConfig": { "command": "a" },
                    "availableIn": { "external": true }
                },
                {
                    "id": "twin-b",
                    "name": "twin",
                    "toolId": "script",
                    "toolConfig": { "command": "b" },
                    "availableIn": { "external": true }
                },
                {
                    "id": "twin-c",
                    "name": "Twin",
                    "toolId": "script",
                    "toolConfig": { "command": "c" },
                    "availableIn": { "external": false }
                },
                {
                    "id": "Lamp",
                    "name": "Свет",
                    "toolId": "webhook",
                    "toolConfig": { "url": "https://example.com", "takesText": false },
                    "availableIn": { "external": true }
                },
                {
                    "id": "lamp-2",
                    "name": "Lamp",
                    "toolId": "webhook",
                    "toolConfig": { "url": "https://example.com" },
                    "availableIn": { "external": true }
                }
            ]
        })
    }

    #[test]
    fn normalizes_names() {
        assert_eq!(normalize_name("  Ёлка   ЗАПИСЬ "), "елка запись");
        assert_eq!(normalize_name("\tWork\nNote"), "work note");
    }

    #[test]
    fn finds_a_command_by_id_first() {
        let found = find(&config(), " backup ").unwrap();
        assert_eq!(
            found,
            ExternalCommand {
                id: String::from("backup"),
                takes_text: false,
                confirm: true,
                shows_menu: false,
            }
        );
        // the id wins over the name of another command
        assert_eq!(find(&config(), "Lamp").unwrap().id, "Lamp");
    }

    #[test]
    fn finds_a_command_by_its_normalized_name() {
        assert_eq!(find(&config(), "бэкап").unwrap().id, "backup");
        let note = find(&config(), "work note").unwrap();
        assert_eq!(note.id, "note");
        assert!(note.takes_text);
        assert!(note.shows_menu);
    }

    #[test]
    fn reports_why_a_command_cannot_be_called() {
        assert_eq!(
            find(&config(), "nothing"),
            Err(LookupError::NotFound(String::from("nothing")))
        );
        assert_eq!(
            find(&config(), ""),
            Err(LookupError::NotFound(String::new()))
        );
        assert_eq!(
            find(&config(), "hidden"),
            Err(LookupError::NotExternal(String::from("hidden")))
        );
        assert_eq!(
            find(&config(), "Off"),
            Err(LookupError::Disabled(String::from("off")))
        );
        assert_eq!(
            find(&config(), "plugin"),
            Err(LookupError::Unavailable(String::from("plugin")))
        );
    }

    #[test]
    fn refuses_a_name_shared_by_callable_commands() {
        // twin-c may not be called from outside, so it does not count
        assert_eq!(
            find(&config(), "TWIN"),
            Err(LookupError::Ambiguous(
                String::from("TWIN"),
                vec![String::from("twin-a"), String::from("twin-b")]
            ))
        );
    }

    #[test]
    fn lists_the_callable_commands() {
        let listed: Value = serde_json::from_str(&list(&config())).unwrap();
        assert_eq!(
            listed,
            json!([
                { "id": "backup", "name": "Бэкап", "input": "none" },
                { "id": "note", "name": "Work  Note", "input": "text" },
                { "id": "twin-a", "name": "Twin", "input": "text" },
                { "id": "twin-b", "name": "twin", "input": "text" },
                { "id": "Lamp", "name": "Свет", "input": "none" },
                { "id": "lamp-2", "name": "Lamp", "input": "text" }
            ])
        );
        assert_eq!(list(&json!({})), "[]");
    }

    #[test]
    fn opens_the_overlay_only_when_it_has_to() {
        let command = |takes_text, confirm, shows_menu| ExternalCommand {
            id: String::from("x"),
            takes_text,
            confirm,
            shows_menu,
        };
        assert_eq!(
            route(&command(false, false, false), None),
            Route::Background
        );
        assert_eq!(
            route(&command(true, false, false), Some("t")),
            Route::Background
        );
        // the text comes from the selection or the field
        assert_eq!(route(&command(true, false, false), None), Route::Overlay);
        assert_eq!(route(&command(false, true, false), None), Route::Overlay);
        // the output goes to the result menu
        assert_eq!(
            route(&command(true, false, true), Some("t")),
            Route::Overlay
        );
    }
}
