use serde_json::Value;
use tauri::{AppHandle, Manager};
use tyco_activation_protocol::{ErrorCode, Response, RunRequest};

use super::ApiResult;
use crate::services::external::command_library::{self, CommandLookupError, ExternalCommand};
use crate::state::AppState;

/// Selection capture is opt-in; which commands run from
/// outside is decided by each command's own grant.
pub(super) fn is_selection_access_allowed(config: &Value) -> bool {
    crate::models::user_config::external_access(config).can_access_selection
}

pub(super) fn ensure_selection_access_allowed(config: &Value) -> ApiResult<()> {
    if is_selection_access_allowed(config) {
        Ok(())
    } else {
        Err(Box::new(Response::coded_error(
            ErrorCode::AccessDenied,
            "External selection access is disabled",
        )))
    }
}

pub(super) fn lookup(app: &AppHandle, target: &str, by_name: bool) -> ApiResult<ExternalCommand> {
    let config = app.state::<AppState>().user_config();
    let catalog = app.state::<command_library::OperationCatalogState>().get();
    if by_name {
        command_library::find_by_name(&config, catalog.as_ref(), target)
    } else {
        command_library::find_by_id(&config, catalog.as_ref(), target)
    }
    .map_err(|error| Box::new(lookup_error(error)))
}

/// The command `id` as the user config holds it.
pub(super) fn raw_command<'a>(config: &'a Value, id: &str) -> Option<&'a Value> {
    config["commands"].as_array().and_then(|commands| {
        // ids compare trimmed, as the lookup in `command_library` does
        commands
            .iter()
            .find(|item| item["id"].as_str().map(str::trim) == Some(id.trim()))
    })
}

/// The name the user gave the command, for the access prompt.
pub(super) fn command_name(config: &Value, id: &str) -> String {
    crate::models::user_config::command(config, id)
        .map(|command| command.name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| id.to_owned())
}

pub(super) fn describe(app: &AppHandle, target: &str, by_name: bool) -> ApiResult<Value> {
    let config = app.state::<AppState>().user_config();
    let catalog = app.state::<command_library::OperationCatalogState>().get();
    command_library::describe(&config, catalog.as_ref(), target, by_name)
        .map_err(|error| Box::new(lookup_error(error)))
}

fn lookup_error(error: CommandLookupError) -> Response {
    let code = match &error {
        CommandLookupError::NotFound(_) => ErrorCode::NotFound,
        CommandLookupError::Ambiguous(_, _) => ErrorCode::AmbiguousName,
        CommandLookupError::Disabled(_) => ErrorCode::Disabled,
        CommandLookupError::NotExternal(_) => ErrorCode::AccessDenied,
        CommandLookupError::Unavailable(_, _) => ErrorCode::Unavailable,
        CommandLookupError::ToolsLoading(_) | CommandLookupError::CatalogStale(_) => {
            ErrorCode::NotReady
        }
    };
    Response::coded_error(code, error.to_string())
}

pub fn validate_run(command: &ExternalCommand, request: &RunRequest) -> ApiResult<()> {
    if request.quiet && (request.selection || request.replace) {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InvalidInput,
            "Quiet runs cannot capture or replace the selection",
        )));
    }
    if request.target.trim().is_empty()
        || (request.text.is_some() && request.input.is_some())
        || (request.selection && (request.text.is_some() || request.input.is_some()))
        || (request.replace && !request.selection)
    {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InvalidInput,
            "Choose one input source; replacement requires selection",
        )));
    }
    if request.selection && !command.accepts_selection() {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InvalidInput,
            "This command does not accept selection text",
        )));
    }
    if !command.can_take_text
        && !command.has_structured_input
        && (request.text.is_some() || request.input.is_some())
    {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InvalidInput,
            "This command does not accept input",
        )));
    }
    if command.has_structured_input && !command.can_take_text && request.text.is_some() {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InvalidInput,
            "This command takes structured input, not text: pass --input",
        )));
    }
    if command.has_structured_input && !command.can_take_text && request.input.is_none() {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InputRequired,
            "This command requires structured input",
        )));
    }
    if request.quiet && command.can_take_text && request.text.is_none() && request.input.is_none() {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InputRequired,
            "This command requires input for a quiet run",
        )));
    }
    // a visible text command without input asks for text in the overlay
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn command() -> ExternalCommand {
        ExternalCommand {
            id: "test".into(),
            can_take_text: true,
            has_structured_input: false,
            can_take_selection: false,
        }
    }

    #[test]
    fn a_text_command_runs_without_input_and_input_sources_are_exclusive() {
        let command = command();
        let mut request = RunRequest {
            target: "test".into(),
            ..Default::default()
        };
        // the overlay asks for the text
        assert!(validate_run(&command, &request).is_ok());
        request.text = Some("\n".into());
        assert!(validate_run(&command, &request).is_ok());
        request.selection = true;
        assert!(validate_run(&command, &request).is_err());
    }

    #[test]
    fn a_command_of_the_selection_alone_takes_selection_but_no_text() {
        let command = ExternalCommand {
            can_take_text: false,
            can_take_selection: true,
            ..command()
        };
        let mut request = RunRequest {
            target: "test".into(),
            selection: true,
            replace: true,
            ..Default::default()
        };
        assert!(validate_run(&command, &request).is_ok());
        request.selection = false;
        request.replace = false;
        request.text = Some("text".into());
        assert!(validate_run(&command, &request).is_err());
    }

    #[test]
    fn a_structured_command_refuses_text_and_requires_input() {
        let command = ExternalCommand {
            can_take_text: false,
            has_structured_input: true,
            ..command()
        };
        let mut request = RunRequest {
            target: "test".into(),
            text: Some("text".into()),
            ..Default::default()
        };
        let error = validate_run(&command, &request).unwrap_err();
        assert_eq!(error.code.as_deref(), Some("InvalidInput"));
        request.text = None;
        let error = validate_run(&command, &request).unwrap_err();
        assert_eq!(error.code.as_deref(), Some("InputRequired"));
    }

    #[test]
    fn quiet_runs_require_explicit_input_and_never_use_selection() {
        let mut request = RunRequest {
            target: "test".into(),
            quiet: true,
            ..Default::default()
        };
        let command = command();
        assert_eq!(
            validate_run(&command, &request)
                .unwrap_err()
                .code
                .as_deref(),
            Some("InputRequired")
        );
        request.text = Some("text".into());
        assert!(validate_run(&command, &request).is_ok());
        request.selection = true;
        assert_eq!(
            validate_run(&command, &request)
                .unwrap_err()
                .code
                .as_deref(),
            Some("InvalidInput")
        );
    }

    #[test]
    fn raw_commands_are_found_by_their_trimmed_id() {
        let config = json!({"commands": [{"id": " backup "}]});
        assert!(raw_command(&config, "backup").is_some());
        assert!(raw_command(&config, "other").is_none());
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
