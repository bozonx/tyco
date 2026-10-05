//! Commands of the library run from outside the app: D-Bus `RunCommand` and
//! `tyco-ctl run`. The command is found here, from the config the backend
//! holds, so a wrong id or name is an error of the call itself. The run is
//! handed to the webview of the quick window: in the background when nothing
//! has to be asked or shown, otherwise in the command overlay. Plugin tools
//! are known from the tool catalog the quick window sends.
//! See `dev_docs/design-voice-commands.md`, §3.4.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tyco_activation_protocol::COMMAND_ACTION_PREFIX;

use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::{runtime, selection_replace};
use crate::state::AppState;

pub const COMMAND_RUN_EVENT: &str = "app://command-run";

/// Tools the backend knows itself; the others come with the tool catalog.
const BUILTIN_TOOLS: [&str; 2] = ["script", "webhook"];

/// How a command of a tool gets its input from a text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolInput {
    None,
    Text,
    /// The tool parses the text itself.
    Parsed,
    /// A structured input: only a command that parses it with the LLM takes
    /// a text.
    Structured,
}

/// A tool as the webview registry describes it, see `set_tool_catalog`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCatalogEntry {
    pub id: String,
    pub input: ToolInput,
    pub available: bool,
    /// Why it is not available, already translated.
    #[serde(default)]
    pub reason: Option<String>,
}

/// The tools of the webview registry by id. Plugin tools and whether a tool
/// can run (it may need the LLM) are known to the webview only: the quick
/// window sends the catalog whenever the plugins load.
pub type ToolCatalog = HashMap<String, ToolCatalogEntry>;

pub fn catalog_from(entries: Vec<ToolCatalogEntry>) -> ToolCatalog {
    entries
        .into_iter()
        .map(|entry| (entry.id.clone(), entry))
        .collect()
}

/// A command found for a call, with what decides how it runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalCommand {
    pub id: String,
    pub takes_text: bool,
    pub confirm: bool,
    pub shows_menu: bool,
    /// Its output replaces the selection, see `afterRun`.
    pub replaces_selection: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupError {
    NotFound(String),
    /// Several commands that may be called have this name.
    Ambiguous(String, Vec<String>),
    Disabled(String),
    NotExternal(String),
    /// Its tool is missing or cannot run now, with the reason if known.
    Unavailable(String, Option<String>),
    /// The webview has not sent the tool catalog yet.
    ToolsLoading(String),
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
            Self::Unavailable(id, None) => {
                write!(f, "The tool of the command `{id}` is not available")
            }
            Self::Unavailable(id, Some(reason)) => {
                write!(
                    f,
                    "The tool of the command `{id}` is not available: {reason}"
                )
            }
            Self::ToolsLoading(id) => write!(
                f,
                "The tools are still loading; try the command `{id}` again in a moment"
            ),
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

fn is_enabled(command: &Value) -> bool {
    command.get("enabled").and_then(Value::as_bool) != Some(false)
}

fn is_external(command: &Value) -> bool {
    command
        .pointer("/availableIn/external")
        .and_then(Value::as_bool)
        == Some(true)
}

/// Whether the tool of the command can run it, and if so whether it takes
/// a text.
fn tool_status(command: &Value, catalog: Option<&ToolCatalog>) -> Result<bool, LookupError> {
    let id = id_of(command).to_owned();
    let tool_id = str_field(command, "toolId").trim();
    if BUILTIN_TOOLS.contains(&tool_id) {
        return Ok(command
            .pointer("/toolConfig/takesText")
            .and_then(Value::as_bool)
            != Some(false));
    }
    let catalog = catalog.ok_or_else(|| LookupError::ToolsLoading(id.clone()))?;
    let tool = catalog
        .get(tool_id)
        .ok_or_else(|| LookupError::Unavailable(id.clone(), None))?;
    if !tool.available {
        return Err(LookupError::Unavailable(id, tool.reason.clone()));
    }
    match tool.input {
        ToolInput::None => Ok(false),
        ToolInput::Text | ToolInput::Parsed => Ok(true),
        ToolInput::Structured
            if command.get("llmArgumentParsing").and_then(Value::as_bool) == Some(true) =>
        {
            Ok(true)
        }
        ToolInput::Structured => Err(LookupError::Unavailable(
            id,
            Some(String::from("its tool needs a structured input")),
        )),
    }
}

/// The command as a call runs it, or why it cannot be called from outside.
fn callable(
    command: &Value,
    catalog: Option<&ToolCatalog>,
) -> Result<ExternalCommand, LookupError> {
    let id = id_of(command).to_owned();
    if !is_enabled(command) {
        return Err(LookupError::Disabled(id));
    }
    if !is_external(command) {
        return Err(LookupError::NotExternal(id));
    }
    let takes_text = tool_status(command, catalog)?;
    let after_run = str_field(command, "afterRun");
    Ok(ExternalCommand {
        id,
        takes_text,
        confirm: str_field(command, "confirm") == "always",
        shows_menu: after_run == "showMenu",
        replaces_selection: after_run == "replaceSelection",
    })
}

/// The command `target` names: the one with this id, otherwise the only one
/// of the callable commands with this name.
pub fn find(
    user_config: &Value,
    catalog: Option<&ToolCatalog>,
    target: &str,
) -> Result<ExternalCommand, LookupError> {
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
                .filter(|command| callable(command, catalog).is_ok())
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
    callable(command, catalog)
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
pub fn list(user_config: &Value, catalog: Option<&ToolCatalog>) -> String {
    let listed: Vec<ListedCommand> = commands_of(user_config)
        .iter()
        .filter(|command| !id_of(command).is_empty())
        .filter_map(|command| Some((command, callable(command, catalog).ok()?)))
        .map(|(command, found)| {
            let name = str_field(command, "name").trim();
            ListedCommand {
                id: id_of(command).to_owned(),
                name: if name.is_empty() {
                    id_of(command)
                } else {
                    name
                }
                .to_owned(),
                input: if found.takes_text { "text" } else { "none" },
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
    /// A selection run: the selection of the focused window is the text, and
    /// the output replaces it, as with the selection hotkeys.
    Selection,
}

fn route(command: &ExternalCommand, text: Option<&str>) -> Route {
    if command.confirm {
        return Route::Overlay;
    }
    if command.replaces_selection {
        // a text of the call is not a selection: the result menu shows the
        // output instead
        return match (command.takes_text, text) {
            (true, None) => Route::Selection,
            _ => Route::Overlay,
        };
    }
    if command.shows_menu || (command.takes_text && text.is_none()) {
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
    let state = app.state::<AppState>();
    let user_config = state.params().user_config;
    let command = find(&user_config, state.tool_catalog().as_ref(), target)?;
    // a command without input has nothing to do with a text
    let text = text
        .filter(|text| !text.trim().is_empty())
        .filter(|_| command.takes_text);

    match route(&command, text.as_deref()) {
        Route::Selection => selection_replace::trigger(
            app,
            &format!("{COMMAND_ACTION_PREFIX}{}", command.id),
            selection_replace::TriggerWait::Now,
        ),
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
                    "toolId": "FastNote.write",
                    "availableIn": { "external": true }
                },
                {
                    "id": "missing-tool",
                    "name": "Missing",
                    "toolId": "Gone.tool",
                    "availableIn": { "external": true }
                },
                {
                    "id": "translate",
                    "name": "Translate",
                    "toolId": "core.translate",
                    "afterRun": "replaceSelection",
                    "availableIn": { "external": true }
                },
                {
                    "id": "lights",
                    "name": "Lights",
                    "toolId": "Home.lights",
                    "availableIn": { "external": true }
                },
                {
                    "id": "remind",
                    "name": "Remind",
                    "toolId": "Home.remind",
                    "llmArgumentParsing": true,
                    "availableIn": { "external": true }
                },
                {
                    "id": "remind-raw",
                    "name": "Remind raw",
                    "toolId": "Home.remind",
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

    fn catalog() -> ToolCatalog {
        let entry = |id: &str, input, available, reason: Option<&str>| ToolCatalogEntry {
            id: id.to_owned(),
            input,
            available,
            reason: reason.map(str::to_owned),
        };
        catalog_from(vec![
            entry("script", ToolInput::Text, true, None),
            entry("FastNote.write", ToolInput::Text, true, None),
            entry(
                "core.translate",
                ToolInput::Text,
                false,
                Some("No LLM is configured"),
            ),
            entry("Home.lights", ToolInput::None, true, None),
            entry("Home.remind", ToolInput::Structured, true, None),
        ])
    }

    fn find_in(target: &str) -> Result<ExternalCommand, LookupError> {
        find(&config(), Some(&catalog()), target)
    }

    #[test]
    fn normalizes_names() {
        assert_eq!(normalize_name("  Ёлка   ЗАПИСЬ "), "елка запись");
        assert_eq!(normalize_name("\tWork\nNote"), "work note");
    }

    #[test]
    fn finds_a_command_by_id_first() {
        let found = find_in(" backup ").unwrap();
        assert_eq!(
            found,
            ExternalCommand {
                id: String::from("backup"),
                takes_text: false,
                confirm: true,
                shows_menu: false,
                replaces_selection: false,
            }
        );
        // the id wins over the name of another command
        assert_eq!(find_in("Lamp").unwrap().id, "Lamp");
    }

    #[test]
    fn finds_a_command_by_its_normalized_name() {
        assert_eq!(find_in("бэкап").unwrap().id, "backup");
        let note = find_in("work note").unwrap();
        assert_eq!(note.id, "note");
        assert!(note.takes_text);
        assert!(note.shows_menu);
    }

    #[test]
    fn reports_why_a_command_cannot_be_called() {
        assert_eq!(
            find_in("nothing"),
            Err(LookupError::NotFound(String::from("nothing")))
        );
        assert_eq!(find_in(""), Err(LookupError::NotFound(String::new())));
        assert_eq!(
            find_in("hidden"),
            Err(LookupError::NotExternal(String::from("hidden")))
        );
        assert_eq!(
            find_in("Off"),
            Err(LookupError::Disabled(String::from("off")))
        );
        assert_eq!(
            find_in("missing-tool"),
            Err(LookupError::Unavailable(String::from("missing-tool"), None))
        );
        assert_eq!(
            find_in("translate"),
            Err(LookupError::Unavailable(
                String::from("translate"),
                Some(String::from("No LLM is configured"))
            ))
        );
        assert!(matches!(
            find_in("remind-raw"),
            Err(LookupError::Unavailable(_, Some(_)))
        ));
    }

    #[test]
    fn learns_plugin_tools_from_the_catalog() {
        assert_eq!(
            find(&config(), None, "plugin"),
            Err(LookupError::ToolsLoading(String::from("plugin")))
        );
        // the backend knows its own tools without the catalog
        assert_eq!(find(&config(), None, "backup").unwrap().id, "backup");
        let note = find_in("plugin").unwrap();
        assert!(note.takes_text);
        assert!(!find_in("lights").unwrap().takes_text);
        // the LLM fills the structured input from the text
        assert!(find_in("remind").unwrap().takes_text);
    }

    #[test]
    fn knows_a_command_that_replaces_the_selection() {
        let mut catalog = catalog();
        catalog.get_mut("core.translate").unwrap().available = true;
        let found = find(&config(), Some(&catalog), "translate").unwrap();
        assert!(found.replaces_selection);
        assert!(!found.shows_menu);
    }

    #[test]
    fn refuses_a_name_shared_by_callable_commands() {
        // twin-c may not be called from outside, so it does not count
        assert_eq!(
            find_in("TWIN"),
            Err(LookupError::Ambiguous(
                String::from("TWIN"),
                vec![String::from("twin-a"), String::from("twin-b")]
            ))
        );
    }

    #[test]
    fn lists_the_callable_commands() {
        let listed: Value = serde_json::from_str(&list(&config(), Some(&catalog()))).unwrap();
        assert_eq!(
            listed,
            json!([
                { "id": "backup", "name": "Бэкап", "input": "none" },
                { "id": "note", "name": "Work  Note", "input": "text" },
                { "id": "plugin", "name": "Plugin", "input": "text" },
                { "id": "lights", "name": "Lights", "input": "none" },
                { "id": "remind", "name": "Remind", "input": "text" },
                { "id": "twin-a", "name": "Twin", "input": "text" },
                { "id": "twin-b", "name": "twin", "input": "text" },
                { "id": "Lamp", "name": "Свет", "input": "none" },
                { "id": "lamp-2", "name": "Lamp", "input": "text" }
            ])
        );
        assert_eq!(list(&json!({}), None), "[]");
    }

    #[test]
    fn opens_the_overlay_only_when_it_has_to() {
        let command = |takes_text, confirm, shows_menu| ExternalCommand {
            id: String::from("x"),
            takes_text,
            confirm,
            shows_menu,
            replaces_selection: false,
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

    #[test]
    fn replaces_the_selection_when_no_text_is_given() {
        let replacing = |confirm| ExternalCommand {
            id: String::from("x"),
            takes_text: true,
            confirm,
            shows_menu: false,
            replaces_selection: true,
        };
        assert_eq!(route(&replacing(false), None), Route::Selection);
        // a given text is no selection: its output goes to the result menu
        assert_eq!(route(&replacing(false), Some("t")), Route::Overlay);
        assert_eq!(route(&replacing(true), None), Route::Overlay);
    }
}
