use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tyco_activation_protocol::{Response, RunRequest};

use super::ApiResult;
use crate::services::external_commands::{self, CommandLookupError, ExternalCommand};
use crate::state::AppState;

/// Selection capture is opt-in; which commands run from
/// outside is decided by each command's own grant.
pub(super) fn is_selection_access_allowed(config: &Value) -> bool {
    config
        .pointer("/externalAccess/canAccessSelection")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(super) fn ensure_selection_access_allowed(config: &Value) -> ApiResult<()> {
    if is_selection_access_allowed(config) {
        Ok(())
    } else {
        Err(Response::coded_error(
            "AccessDenied",
            "External selection access is disabled",
        ))
    }
}

pub(super) fn lookup(app: &AppHandle, target: &str, by_name: bool) -> ApiResult<ExternalCommand> {
    let state = app.state::<AppState>();
    let config = state.snapshot().settings.user_config;
    let catalog = state.tool_catalog();
    if by_name {
        external_commands::find_by_name(&config, catalog.as_ref(), target)
    } else {
        external_commands::find_by_id(&config, catalog.as_ref(), target)
    }
    .map_err(lookup_error)
}

/// The command `id` as the user config holds it.
pub(super) fn raw_command<'a>(config: &'a Value, id: &str) -> Option<&'a Value> {
    config["commands"]
        .as_array()
        .and_then(|commands| commands.iter().find(|item| item["id"] == id))
}

/// The name the user gave the command, for the access prompt.
pub(super) fn command_name(config: &Value, id: &str) -> String {
    raw_command(config, id)
        .and_then(|command| command["name"].as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(id)
        .to_owned()
}

pub(super) fn describe(app: &AppHandle, target: &str, by_name: bool) -> ApiResult<Value> {
    let command = lookup(app, target, by_name)?;
    let state = app.state::<AppState>();
    let config = state.snapshot().settings.user_config;
    let raw = raw_command(&config, &command.id);
    let input_schema = raw
        .and_then(|raw| raw["toolId"].as_str())
        .and_then(|tool_id| {
            state
                .tool_catalog()
                .and_then(|catalog| catalog.get(tool_id).cloned())
        })
        .and_then(|tool| tool.input_schema);
    Ok(json!({
        "id": command.id,
        "name": raw.and_then(|item| item.get("name")),
        "input": if command.has_structured_input {
            "structured"
        } else if command.can_take_text {
            "text"
        } else {
            "none"
        },
        "textAccepted": command.can_take_text,
        "canReplaceSelection": command.can_take_text && !command.has_structured_input,
        "output": "return",
        "inputSchema": input_schema,
    }))
}

fn lookup_error(error: CommandLookupError) -> Response {
    let code = match &error {
        CommandLookupError::NotFound(_) => "NotFound",
        CommandLookupError::Ambiguous(_, _) => "AmbiguousName",
        CommandLookupError::Disabled(_) => "Disabled",
        CommandLookupError::NotExternal(_) => "AccessDenied",
        CommandLookupError::Unavailable(_, _) => "Unavailable",
        CommandLookupError::ToolsLoading(_) => "NotReady",
    };
    Response::coded_error(code, error.to_string())
}

pub fn validate_run(command: &ExternalCommand, request: &RunRequest) -> ApiResult<()> {
    if request.target.trim().is_empty()
        || (request.text.is_some() && request.input.is_some())
        || (request.selection && (request.text.is_some() || request.input.is_some()))
        || (request.replace && !request.selection)
    {
        return Err(Response::coded_error(
            "InvalidInput",
            "Choose one input source; replacement requires selection",
        ));
    }
    if request.selection && (!command.can_take_text || command.has_structured_input) {
        return Err(Response::coded_error(
            "InvalidInput",
            "This command does not accept selection text",
        ));
    }
    if !command.can_take_text
        && !command.has_structured_input
        && (request.text.is_some() || request.input.is_some())
    {
        return Err(Response::coded_error(
            "InvalidInput",
            "This command does not accept input",
        ));
    }
    if command.has_structured_input && !command.can_take_text && request.input.is_none() {
        return Err(Response::coded_error(
            "InputRequired",
            "This command requires structured input",
        ));
    }
    if command.can_take_text
        && request.text.is_none()
        && request.input.is_none()
        && !request.selection
        && !request.interactive
    {
        return Err(Response::coded_error(
            "InputRequired",
            "Provide text, structured input, or an explicit selection",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command() -> ExternalCommand {
        ExternalCommand {
            id: "test".into(),
            can_take_text: true,
            has_structured_input: false,
        }
    }

    #[test]
    fn automation_requires_explicit_input() {
        let command = command();
        let mut request = RunRequest {
            target: "test".into(),
            ..Default::default()
        };
        assert_eq!(
            validate_run(&command, &request)
                .unwrap_err()
                .code
                .as_deref(),
            Some("InputRequired")
        );
        request.text = Some("\n".into());
        assert!(validate_run(&command, &request).is_ok());
        request.interactive = true;
        assert!(validate_run(&command, &request).is_ok());
        request.selection = true;
        assert!(validate_run(&command, &request).is_err());
    }

    #[test]
    fn permission_defaults_deny_capture() {
        assert!(ensure_selection_access_allowed(&json!({})).is_err());
        assert!(ensure_selection_access_allowed(&json!({"externalAccess":null})).is_err());
        assert!(ensure_selection_access_allowed(
            &json!({"externalAccess":{"canAccessSelection":"true"}})
        )
        .is_err());
        assert!(ensure_selection_access_allowed(
            &json!({"externalAccess":{"canAccessSelection":true}})
        )
        .is_ok());
    }
}
