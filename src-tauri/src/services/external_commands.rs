//! Commands of the library run from outside the app through `tyco-ctl run`
//! and interactive selection actions. The command is found here, from the config the backend
//! holds, so a wrong id or name is an error of the call itself. The run is
//! handed to the webview of the quick window: in the background when nothing
//! has to be asked or shown, otherwise in the command overlay. Plugin tools
//! are known from the tool catalog the quick window sends.
//! See `dev_docs/design-voice-commands.md`, §3.4.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::AppError;
use crate::services::custom_actions::TEXT_PLACEHOLDER;

pub const COMMAND_RUN_EVENT: &str = "app://command-run";

/// How a command of a tool gets its input from a text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolInputKind {
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
    pub input: ToolInputKind,
    #[serde(rename = "available")]
    pub is_available: bool,
    /// Why it is not available, already translated.
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub input_schema: Option<Value>,
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
    pub can_take_text: bool,
    pub has_structured_input: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandLookupError {
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

impl std::fmt::Display for CommandLookupError {
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

impl From<CommandLookupError> for AppError {
    fn from(error: CommandLookupError) -> Self {
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

fn can_run_externally(command: &Value) -> bool {
    command
        .pointer("/availableIn/external")
        .and_then(Value::as_bool)
        == Some(true)
}

/// Whether a script takes the text: its command mentions `{{TEXT}}`.
/// Keep in sync with `scriptTakesText` in
/// `packages/shared/src/user-config.ts`.
fn script_can_take_text(config: &Value) -> bool {
    let command = str_field(config, "command");
    command.contains(TEXT_PLACEHOLDER)
}

/// Whether a webhook takes the text: `{{TEXT}}` is in its URL or in the body
/// of a POST request. Keep in sync with `webhookTakesText` in
/// `packages/shared/src/user-config.ts`.
fn webhook_can_take_text(config: &Value) -> bool {
    str_field(config, "url").contains(TEXT_PLACEHOLDER)
        || (str_field(config, "method") != "GET"
            && str_field(config, "payloadTemplate").contains(TEXT_PLACEHOLDER))
}

/// Whether the tool of the command can run it, and if so whether it takes
/// a text.
fn resolve_text_input_support(
    command: &Value,
    catalog: Option<&ToolCatalog>,
) -> Result<bool, CommandLookupError> {
    let id = id_of(command).to_owned();
    let tool_id = str_field(command, "toolId").trim();
    let config = command.get("toolConfig").unwrap_or(&Value::Null);
    match tool_id {
        "script" => return Ok(script_can_take_text(config)),
        "webhook" => return Ok(webhook_can_take_text(config)),
        _ => {}
    }
    let catalog = catalog.ok_or_else(|| CommandLookupError::ToolsLoading(id.clone()))?;
    let tool = catalog
        .get(tool_id)
        .ok_or_else(|| CommandLookupError::Unavailable(id.clone(), None))?;
    if !tool.is_available {
        return Err(CommandLookupError::Unavailable(id, tool.reason.clone()));
    }
    match tool.input {
        ToolInputKind::None => Ok(false),
        ToolInputKind::Text | ToolInputKind::Parsed => Ok(true),
        ToolInputKind::Structured
            if command
                .get("isLlmArgumentParsingEnabled")
                .and_then(Value::as_bool)
                == Some(true) =>
        {
            Ok(true)
        }
        ToolInputKind::Structured => Ok(false),
    }
}

/// The command as a call runs it, or why it cannot be called from outside.
fn resolve_callable_command(
    command: &Value,
    catalog: Option<&ToolCatalog>,
) -> Result<ExternalCommand, CommandLookupError> {
    let id = id_of(command).to_owned();
    if !is_enabled(command) {
        return Err(CommandLookupError::Disabled(id));
    }
    if !can_run_externally(command) {
        return Err(CommandLookupError::NotExternal(id));
    }
    let can_take_text = resolve_text_input_support(command, catalog)?;
    Ok(ExternalCommand {
        id,
        can_take_text,
        has_structured_input: catalog
            .and_then(|catalog| catalog.get(str_field(command, "toolId")))
            .is_some_and(|tool| tool.input == ToolInputKind::Structured),
    })
}

/// The command with the id `id`. A name never stands for an id: a call by
/// name says so explicitly, see `find_by_name`.
pub fn find_by_id(
    user_config: &Value,
    catalog: Option<&ToolCatalog>,
    id: &str,
) -> Result<ExternalCommand, CommandLookupError> {
    let id = id.trim();
    commands_of(user_config)
        .iter()
        .find(|command| !id.is_empty() && id_of(command) == id)
        .ok_or_else(|| CommandLookupError::NotFound(id.to_owned()))
        .and_then(|command| resolve_callable_command(command, catalog))
}

/// The only callable command with the name `name`, compared normalized.
pub fn find_by_name(
    user_config: &Value,
    catalog: Option<&ToolCatalog>,
    name: &str,
) -> Result<ExternalCommand, CommandLookupError> {
    let normalized = normalize_name(name);
    let matches: Vec<&Value> = commands_of(user_config)
        .iter()
        .filter(|command| {
            !normalized.is_empty() && normalize_name(str_field(command, "name")) == normalized
        })
        .collect();
    let callable_matches: Vec<ExternalCommand> = matches
        .iter()
        .filter_map(|command| resolve_callable_command(command, catalog).ok())
        .collect();
    match callable_matches.as_slice() {
        [command] => Ok(command.clone()),
        [] => match matches.first() {
            Some(command) => resolve_callable_command(command, catalog),
            None => Err(CommandLookupError::NotFound(name.into())),
        },
        several => Err(CommandLookupError::Ambiguous(
            name.into(),
            several.iter().map(|command| command.id.clone()).collect(),
        )),
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ListedCommand {
    id: String,
    name: String,
    /// `text` or `none`
    input: &'static str,
    can_replace_selection: bool,
    /// External callers always receive the output.
    output: &'static str,
}

/// The commands that may be called from outside, as a JSON array of
/// `{ id, name, input, ... }`, in the order of the library.
pub fn list(user_config: &Value, catalog: Option<&ToolCatalog>) -> Value {
    let listed: Vec<ListedCommand> = commands_of(user_config)
        .iter()
        .filter(|command| !id_of(command).is_empty())
        .filter_map(|command| Some((command, resolve_callable_command(command, catalog).ok()?)))
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
                input: if found.has_structured_input {
                    "structured"
                } else if found.can_take_text {
                    "text"
                } else {
                    "none"
                },
                can_replace_selection: found.can_take_text && !found.has_structured_input,
                output: "return",
            }
        })
        .collect();
    serde_json::to_value(listed).unwrap_or_else(|_| Value::Array(Vec::new()))
}

/// A command the overlay opens with, see `Activation::launcher_request`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherRequest {
    pub command_id: String,
    /// The text of the call; without it the selection or the field gives it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Map<String, Value>>,
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
                    "toolConfig": { "command": "backup.sh" },
                    "availableIn": { "launcher": true, "external": true }
                },
                {
                    "id": "note",
                    "name": "Work  Note",
                    "toolId": "webhook",
                    "toolConfig": { "url": "https://example.com/?q={{TEXT}}" },
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
                    "afterRun": "insertIntoWindow",
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
                    "isLlmArgumentParsingEnabled": true,
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
                    "toolConfig": { "url": "https://example.com" },
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
            is_available: available,
            reason: reason.map(str::to_owned),
            input_schema: None,
        };
        catalog_from(vec![
            entry("script", ToolInputKind::Text, true, None),
            entry("FastNote.write", ToolInputKind::Text, true, None),
            entry(
                "core.translate",
                ToolInputKind::Text,
                false,
                Some("No LLM is configured"),
            ),
            entry("Home.lights", ToolInputKind::None, true, None),
            entry("Home.remind", ToolInputKind::Structured, true, None),
        ])
    }

    fn find_in(id: &str) -> Result<ExternalCommand, CommandLookupError> {
        find_by_id(&config(), Some(&catalog()), id)
    }

    fn find_named(name: &str) -> Result<ExternalCommand, CommandLookupError> {
        find_by_name(&config(), Some(&catalog()), name)
    }

    #[test]
    fn ids_and_names_do_not_stand_for_each_other() {
        assert_eq!(find_named("Lamp").unwrap().id, "lamp-2");
        assert_eq!(find_in("Lamp").unwrap().id, "Lamp");
        assert_eq!(
            find_in("Бэкап"),
            Err(CommandLookupError::NotFound(String::from("Бэкап")))
        );
    }

    #[test]
    fn normalizes_names() {
        assert_eq!(normalize_name("  Ёлка   ЗАПИСЬ "), "елка запись");
        assert_eq!(normalize_name("\tWork\nNote"), "work note");
    }

    #[test]
    fn finds_a_command_by_its_trimmed_id() {
        let found = find_in(" backup ").unwrap();
        assert_eq!(
            found,
            ExternalCommand {
                id: String::from("backup"),
                can_take_text: false,
                has_structured_input: false,
            }
        );
    }

    #[test]
    fn finds_a_command_by_its_normalized_name() {
        assert_eq!(find_named("бэкап").unwrap().id, "backup");
        let note = find_named("work note").unwrap();
        assert_eq!(note.id, "note");
        assert!(note.can_take_text);
    }

    #[test]
    fn reports_why_a_command_cannot_be_called() {
        assert_eq!(
            find_in("nothing"),
            Err(CommandLookupError::NotFound(String::from("nothing")))
        );
        assert_eq!(
            find_in(""),
            Err(CommandLookupError::NotFound(String::new()))
        );
        assert_eq!(
            find_in("hidden"),
            Err(CommandLookupError::NotExternal(String::from("hidden")))
        );
        assert_eq!(
            find_named("Off"),
            Err(CommandLookupError::Disabled(String::from("off")))
        );
        assert_eq!(
            find_in("missing-tool"),
            Err(CommandLookupError::Unavailable(
                String::from("missing-tool"),
                None
            ))
        );
        assert_eq!(
            find_in("translate"),
            Err(CommandLookupError::Unavailable(
                String::from("translate"),
                Some(String::from("No LLM is configured"))
            ))
        );
        assert!(find_in("remind-raw").unwrap().has_structured_input);
    }

    #[test]
    fn learns_plugin_tools_from_the_catalog() {
        assert_eq!(
            find_by_id(&config(), None, "plugin"),
            Err(CommandLookupError::ToolsLoading(String::from("plugin")))
        );
        // the backend knows its own tools without the catalog
        assert_eq!(find_by_id(&config(), None, "backup").unwrap().id, "backup");
        let note = find_in("plugin").unwrap();
        assert!(note.can_take_text);
        assert!(!find_in("lights").unwrap().can_take_text);
        // the LLM fills the structured input from the text
        assert!(find_in("remind").unwrap().can_take_text);
    }

    #[test]
    fn a_script_takes_the_text_it_mentions() {
        assert!(script_can_take_text(&json!({ "command": "echo {{TEXT}}" })));
        assert!(!script_can_take_text(
            &json!({ "command": "printf %s \"$TYCO_TEXT\"" })
        ));
        assert!(!script_can_take_text(&json!({ "command": "backup.sh" })));
        assert!(!script_can_take_text(&json!({})));
    }

    #[test]
    fn a_webhook_takes_the_text_where_its_placeholder_stands() {
        assert!(webhook_can_take_text(
            &json!({ "url": "https://x.test/?q={{TEXT}}", "method": "GET" })
        ));
        assert!(webhook_can_take_text(&json!({
            "url": "https://x.test",
            "payloadTemplate": "{\"text\": \"{{TEXT}}\"}"
        })));
        // a GET request sends no body
        assert!(!webhook_can_take_text(&json!({
            "url": "https://x.test",
            "method": "GET",
            "payloadTemplate": "{{TEXT}}"
        })));
        assert!(!webhook_can_take_text(&json!({ "url": "https://x.test" })));
    }

    #[test]
    fn accepts_commands_independently_of_launcher_output_settings() {
        let mut catalog = catalog();
        catalog.get_mut("core.translate").unwrap().is_available = true;
        let found = find_by_id(&config(), Some(&catalog), "translate").unwrap();
        assert!(found.can_take_text);
    }

    #[test]
    fn refuses_a_name_shared_by_callable_commands() {
        // twin-c may not be called from outside, so it does not count
        assert_eq!(
            find_named("TWIN"),
            Err(CommandLookupError::Ambiguous(
                String::from("TWIN"),
                vec![String::from("twin-a"), String::from("twin-b")]
            ))
        );
    }

    #[test]
    fn lists_the_callable_commands() {
        let listed = list(&config(), Some(&catalog()));
        assert!(listed
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["canReplaceSelection"].is_boolean()
                && item["output"] == "return"
                && item.get("afterRun").is_none()));
        let essential: Vec<Value> = listed
            .as_array()
            .unwrap()
            .iter()
            .map(|item| json!({"id":item["id"],"name":item["name"],"input":item["input"]}))
            .collect();
        assert_eq!(
            json!(essential),
            json!([
                { "id": "backup", "name": "Бэкап", "input": "none" },
                { "id": "note", "name": "Work  Note", "input": "text" },
                { "id": "plugin", "name": "Plugin", "input": "text" },
                { "id": "lights", "name": "Lights", "input": "none" },
                { "id": "remind", "name": "Remind", "input": "structured" },
                { "id": "remind-raw", "name": "Remind raw", "input": "structured" },
                { "id": "twin-a", "name": "Twin", "input": "none" },
                { "id": "twin-b", "name": "twin", "input": "none" },
                { "id": "Lamp", "name": "Свет", "input": "none" },
                { "id": "lamp-2", "name": "Lamp", "input": "none" }
            ])
        );
        assert_eq!(list(&json!({}), None), json!([]));
    }
}
