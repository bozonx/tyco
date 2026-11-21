//! Commands of the library run from outside the app through `tyco-ctl run`
//! and D-Bus. The command is found here, from the config the backend holds,
//! so a wrong id or name is an error of the call itself. The run is handed to
//! the webview of the quick window, which runs it in the background: a call
//! must bring its input, no window asks for it. Plugin tools are known from
//! the tool catalog the quick window sends.

use crate::locks::MutexExt;
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::AppError;
use crate::services::custom_actions::{SELECTION_PLACEHOLDER, TEXT_PLACEHOLDER};

/// How a command of a tool gets its input from a text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OperationCatalogInput")]
pub enum OperationInputKind {
    None,
    Text,
    /// The tool parses the text itself.
    Parsed,
    /// A structured input: only a command that parses it with the LLM takes
    /// a text.
    Structured,
}

/// Effective input for one configured command, computed by its tool registry.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct CommandInputDescription {
    #[ts(type = "Record<string, unknown>")]
    pub operation_config: Value,
    pub input: OperationInputKind,
    #[ts(type = "Record<string, unknown>")]
    pub input_schema: Value,
}

/// A tool as the webview registry describes it, see `set_operation_catalog`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct OperationCatalogEntry {
    pub id: String,
    pub input: OperationInputKind,
    #[serde(rename = "available")]
    pub is_available: bool,
    /// Why it is not available, already translated.
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    #[ts(type = "Record<string, unknown>", optional = nullable)]
    pub input_schema: Option<Value>,
    #[serde(default)]
    pub command_inputs: HashMap<String, CommandInputDescription>,
}

/// The tools of the webview registry by id. Plugin tools and whether a tool
/// can run (it may need the LLM) are known to the webview only: the quick
/// window sends the catalog whenever the plugins load.
pub type OperationCatalog = HashMap<String, OperationCatalogEntry>;

/// The tool catalog the quick window sent last; `None` until it does.
#[derive(Default)]
pub struct OperationCatalogState(std::sync::Mutex<Option<OperationCatalog>>);

impl OperationCatalogState {
    pub fn get(&self) -> Option<OperationCatalog> {
        self.0.locked().clone()
    }

    pub fn set(&self, catalog: OperationCatalog) {
        *self.0.locked() = Some(catalog);
    }
}

pub fn catalog_from(entries: Vec<OperationCatalogEntry>) -> OperationCatalog {
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
    /// A script or a webhook that mentions `{{SELECTION}}`: a call with
    /// `--selection` fills it even when the command takes no text.
    pub can_take_selection: bool,
}

impl ExternalCommand {
    /// Whether a call may pass `--selection` and replace it with the output.
    pub fn accepts_selection(&self) -> bool {
        (self.can_take_text && !self.has_structured_input) || self.can_take_selection
    }
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
    /// The catalog describes another config of the command: the quick window
    /// has not sent the catalog of the current config yet
    CatalogStale(String),
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
            Self::CatalogStale(id) => write!(
                f,
                "The tools have not caught up with a change of the command `{id}`; try again in a moment"
            ),
            Self::ToolsLoading(id) => write!(
                f,
                "The tools are still loading; try the command `{id}` again in a moment"
            ),
        }
    }
}

impl From<CommandLookupError> for AppError {
    fn from(error: CommandLookupError) -> Self {
        let message = error.to_string();
        match error {
            CommandLookupError::Unavailable(..)
            | CommandLookupError::ToolsLoading(_)
            | CommandLookupError::CatalogStale(_) => AppError::ServiceUnavailable(message),
            CommandLookupError::NotFound(_)
            | CommandLookupError::Ambiguous(..)
            | CommandLookupError::Disabled(_)
            | CommandLookupError::NotExternal(_) => AppError::InvalidInput(message),
        }
    }
}

/// A name as calls compare it: case, `ё`, and spaces do not matter. Keep in
/// sync with `normalizeCommandName` in `lib/commands/command-external.ts`.
pub fn normalize_name(name: &str) -> String {
    name.to_lowercase()
        .replace('ё', "е")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The commands of the library. The legacy `core.translate` entries are left
/// out, as `normalizeCommands` in `config-schema.ts` drops them: the overlay
/// would not find such a command.
fn commands_of(user_config: &Value) -> impl Iterator<Item = &Value> {
    user_config
        .get("commands")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter(|command| str_field(command, "operationId").trim() != "core.translate")
}

fn str_field<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn id_of(command: &Value) -> &str {
    str_field(command, "id").trim()
}

/// Missing counts as enabled, as the schema default; keep in sync with
/// `CommandConfig::is_enabled` in `models/user_config.rs`.
fn is_enabled(command: &Value) -> bool {
    command.get("isEnabled").and_then(Value::as_bool) != Some(false)
}

fn can_run_externally(command: &Value) -> bool {
    command
        .get("isAvailableExternally")
        .and_then(Value::as_bool)
        == Some(true)
}

pub fn command_input<'a>(
    command: &Value,
    tool: &'a OperationCatalogEntry,
) -> Result<Option<&'a CommandInputDescription>, CommandLookupError> {
    let Some(input) = tool.command_inputs.get(id_of(command)) else {
        return Ok(None);
    };
    if input.operation_config
        != command
            .get("operationConfig")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}))
    {
        return Err(CommandLookupError::CatalogStale(id_of(command).into()));
    }
    Ok(Some(input))
}

fn input_kind(
    command: &Value,
    tool: &OperationCatalogEntry,
) -> Result<OperationInputKind, CommandLookupError> {
    Ok(command_input(command, tool)?.map_or(tool.input, |input| input.input))
}

/// Whether a script takes the text: its command mentions `{{TEXT}}`.
/// Keep in sync with `scriptTakesText` in
/// `packages/shared/src/user-config/commands-config.ts`.
fn script_can_take_text(config: &Value) -> bool {
    let command = str_field(config, "command");
    command.contains(TEXT_PLACEHOLDER)
}

/// Whether a webhook takes the text: `{{TEXT}}` is in its URL or in the body
/// of a POST request. Keep in sync with `webhookTakesText` in
/// `packages/shared/src/user-config/commands-config.ts`.
fn webhook_can_take_text(config: &Value) -> bool {
    str_field(config, "url").contains(TEXT_PLACEHOLDER)
        || (!is_get(config) && str_field(config, "payloadTemplate").contains(TEXT_PLACEHOLDER))
}

/// Whether a script or a webhook mentions `{{SELECTION}}`. Keep in sync with
/// `scriptTakesSelection` and `webhookTakesSelection` in
/// `packages/shared/src/user-config/commands-config.ts`.
fn can_take_selection(command: &Value) -> bool {
    let config = command.get("operationConfig").unwrap_or(&Value::Null);
    match str_field(command, "operationId").trim() {
        "script" => str_field(config, "command").contains(SELECTION_PLACEHOLDER),
        "webhook" => {
            str_field(config, "url").contains(SELECTION_PLACEHOLDER)
                || (!is_get(config)
                    && str_field(config, "payloadTemplate").contains(SELECTION_PLACEHOLDER))
        }
        _ => false,
    }
}

/// A webhook sends GET only when it says so exactly, as the schema spells it;
/// anything else is POST, see `webhookOperationConfigOf`.
fn is_get(config: &Value) -> bool {
    str_field(config, "method") == "GET"
}

/// Whether the tool of the command can run it, and if so whether it takes
/// a text.
fn resolve_text_input_support(
    command: &Value,
    catalog: Option<&OperationCatalog>,
) -> Result<bool, CommandLookupError> {
    let id = id_of(command).to_owned();
    let operation_id = str_field(command, "operationId").trim();
    let config = command.get("operationConfig").unwrap_or(&Value::Null);
    match operation_id {
        "script" => return Ok(script_can_take_text(config)),
        "webhook" => return Ok(webhook_can_take_text(config)),
        _ => {}
    }
    let catalog = catalog.ok_or_else(|| CommandLookupError::ToolsLoading(id.clone()))?;
    let tool = catalog
        .get(operation_id)
        .ok_or_else(|| CommandLookupError::Unavailable(id.clone(), None))?;
    if !tool.is_available {
        return Err(CommandLookupError::Unavailable(id, tool.reason.clone()));
    }
    match input_kind(command, tool)? {
        OperationInputKind::None => Ok(false),
        OperationInputKind::Text | OperationInputKind::Parsed => Ok(true),
        OperationInputKind::Structured
            if command
                .get("isLlmArgumentParsingEnabled")
                .and_then(Value::as_bool)
                == Some(true) =>
        {
            Ok(true)
        }
        OperationInputKind::Structured => Ok(false),
    }
}

/// The command as a call runs it, or why it cannot be called from outside.
fn resolve_callable_command(
    command: &Value,
    catalog: Option<&OperationCatalog>,
) -> Result<ExternalCommand, CommandLookupError> {
    let id = id_of(command).to_owned();
    if !is_enabled(command) {
        return Err(CommandLookupError::Disabled(id));
    }
    if !can_run_externally(command) {
        return Err(CommandLookupError::NotExternal(id));
    }
    let platforms = crate::models::user_config::platforms_from(
        command.get("platforms").unwrap_or(&Value::Null),
    );
    if !crate::models::user_config::is_on_this_platform(&platforms) {
        return Err(CommandLookupError::Unavailable(
            id,
            Some(String::from("it does not run on this platform")),
        ));
    }
    let can_take_text = resolve_text_input_support(command, catalog)?;
    Ok(ExternalCommand {
        id,
        can_take_text,
        has_structured_input: catalog
            .and_then(|catalog| catalog.get(str_field(command, "operationId").trim()))
            .map(|tool| input_kind(command, tool))
            .transpose()?
            .is_some_and(|input| input == OperationInputKind::Structured),
        can_take_selection: can_take_selection(command),
    })
}

/// The command with the id `id`. A name never stands for an id: a call by
/// name says so explicitly, see `find_by_name`.
pub fn find_by_id(
    user_config: &Value,
    catalog: Option<&OperationCatalog>,
    id: &str,
) -> Result<ExternalCommand, CommandLookupError> {
    let id = id.trim();
    commands_of(user_config)
        .find(|command| !id.is_empty() && id_of(command) == id)
        .ok_or_else(|| CommandLookupError::NotFound(id.to_owned()))
        .and_then(|command| resolve_callable_command(command, catalog))
}

/// The only callable command with the name `name`, compared normalized.
pub fn find_by_name(
    user_config: &Value,
    catalog: Option<&OperationCatalog>,
    name: &str,
) -> Result<ExternalCommand, CommandLookupError> {
    let normalized = normalize_name(name);
    let matches: Vec<&Value> = commands_of(user_config)
        .filter(|command| {
            !normalized.is_empty() && normalize_name(str_field(command, "name")) == normalized
        })
        .collect();
    let resolved: Vec<Result<ExternalCommand, CommandLookupError>> = matches
        .iter()
        .map(|command| resolve_callable_command(command, catalog))
        .collect();
    let callable_matches: Vec<&ExternalCommand> = resolved
        .iter()
        .filter_map(|found| found.as_ref().ok())
        .collect();
    // a command whose tools are still loading may turn out callable as well:
    // running another one of the same name now could run the wrong one
    let loading = resolved.iter().find_map(|found| match found {
        Err(
            error @ (CommandLookupError::ToolsLoading(_) | CommandLookupError::CatalogStale(_)),
        ) => Some(error.clone()),
        _ => None,
    });
    match (callable_matches.as_slice(), loading) {
        (several @ [_, _, ..], _) => Err(CommandLookupError::Ambiguous(
            name.into(),
            several.iter().map(|command| command.id.clone()).collect(),
        )),
        (_, Some(loading)) => Err(loading),
        ([command], None) => Ok((*command).clone()),
        ([], None) => resolved
            .into_iter()
            .min_by_key(|found| match found {
                // the reason that says most about why the name cannot be called
                Err(CommandLookupError::Unavailable(..)) => 0,
                Err(CommandLookupError::NotExternal(_)) => 1,
                Err(CommandLookupError::Disabled(_)) => 2,
                _ => 3,
            })
            .unwrap_or_else(|| Err(CommandLookupError::NotFound(name.into()))),
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ListedCommand {
    id: String,
    name: String,
    /// `structured`, `text` or `none`
    input: &'static str,
    can_replace_selection: bool,
    /// External callers always receive the output.
    output: &'static str,
}

/// The name a call shows for the command: its id when it has none.
fn display_name(command: &Value) -> &str {
    let name = str_field(command, "name").trim();
    if name.is_empty() {
        id_of(command)
    } else {
        name
    }
}

/// The commands that may be called from outside, as a JSON array of
/// `{ id, name, input, ... }`, in the order of the library.
pub fn list(user_config: &Value, catalog: Option<&OperationCatalog>) -> Value {
    let listed: Vec<ListedCommand> = commands_of(user_config)
        .filter(|command| !id_of(command).is_empty())
        .filter_map(|command| Some((command, resolve_callable_command(command, catalog).ok()?)))
        .map(|(command, found)| ListedCommand {
            id: id_of(command).to_owned(),
            name: display_name(command).to_owned(),
            input: if found.has_structured_input {
                "structured"
            } else if found.can_take_text {
                "text"
            } else {
                "none"
            },
            can_replace_selection: found.accepts_selection(),
            output: "return",
        })
        .collect();
    serde_json::to_value(listed).unwrap_or_else(|_| Value::Array(Vec::new()))
}

/// Describe the same effective input used by the execution registry.
pub fn describe(
    user_config: &Value,
    catalog: Option<&OperationCatalog>,
    target: &str,
    by_name: bool,
) -> Result<Value, CommandLookupError> {
    let command = if by_name {
        find_by_name(user_config, catalog, target)?
    } else {
        find_by_id(user_config, catalog, target)?
    };
    let raw = commands_of(user_config).find(|raw| id_of(raw) == command.id);
    let tool = raw.and_then(|raw| catalog?.get(str_field(raw, "operationId").trim()));
    let schema = match (raw, tool) {
        (Some(raw), Some(tool)) => command_input(raw, tool)?
            .map(|input| input.input_schema.clone())
            .or_else(|| tool.input_schema.clone()),
        _ => None,
    };
    Ok(serde_json::json!({
        "id": command.id,
        "name": raw.map_or(command.id.as_str(), display_name),
        "input": if command.has_structured_input { "structured" } else if command.can_take_text { "text" } else { "none" },
        "textAccepted": command.can_take_text,
        "canReplaceSelection": command.accepts_selection(),
        "output": "return",
        "inputSchema": schema,
    }))
}

#[cfg(test)]
mod tests;
