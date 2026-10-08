//! The authorization and dispatch boundary shared by D-Bus and local IPC.
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tyco_activation_protocol::{Job, JobState, Request, Response, RunRequest, API_VERSION};

use super::activation::{Activation, ActivationSource, StartMode};
use super::external_commands::{self, ExternalCommand, LookupError};
use super::external_jobs::ExternalJobs;
use super::{runtime, selection_replace};
use crate::state::AppState;

pub const JOB_CANCEL_EVENT: &str = "app://external-job-cancel";

type ApiResult<T> = Result<T, Response>;

fn access_allowed(config: &Value, capability: &str) -> bool {
    match config.get("externalAccess") {
        None => capability == "commands",
        Some(access) if access.is_object() => match access.get(capability) {
            None => capability == "commands",
            Some(value) => value.as_bool().unwrap_or(false),
        },
        Some(_) => false,
    }
}

fn permission(config: &Value, capability: &str) -> ApiResult<()> {
    if access_allowed(config, capability) {
        Ok(())
    } else {
        Err(Response::coded_error(
            "AccessDenied",
            format!("External {capability} access is disabled"),
        ))
    }
}

fn lookup(app: &AppHandle, request: &RunRequest) -> ApiResult<ExternalCommand> {
    let state = app.state::<AppState>();
    let config = state.params().user_config;
    permission(&config, "commands")?;
    if !request.by_name
        && !config
            .get("commands")
            .and_then(Value::as_array)
            .is_some_and(|commands| {
                commands.iter().any(|command| {
                    command.get("id").and_then(Value::as_str) == Some(request.target.as_str())
                })
            })
    {
        return Err(Response::coded_error("NotFound", "No command with this ID"));
    }
    if request.by_name {
        external_commands::find_by_name(&config, state.tool_catalog().as_ref(), &request.target)
    } else {
        external_commands::find(&config, state.tool_catalog().as_ref(), &request.target)
    }
    .map_err(lookup_error)
}

fn lookup_error(error: LookupError) -> Response {
    let code = match &error {
        LookupError::NotFound(_) => "NotFound",
        LookupError::Ambiguous(_, _) => "AmbiguousName",
        LookupError::Disabled(_) => "Disabled",
        LookupError::NotExternal(_) => "AccessDenied",
        LookupError::Unavailable(_, _) => "Unavailable",
        LookupError::ToolsLoading(_) => "NotReady",
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
    if request.selection && (!command.takes_text || command.structured) {
        return Err(Response::coded_error(
            "InvalidInput",
            "This command does not accept selection text",
        ));
    }
    if !command.takes_text
        && !command.structured
        && (request.text.is_some() || request.input.is_some())
    {
        return Err(Response::coded_error(
            "InvalidInput",
            "This command does not accept input",
        ));
    }
    if request.output == tyco_activation_protocol::OutputMode::Configured
        && (command.shows_menu || (command.replaces_selection && !request.replace))
        && !request.interactive
    {
        return Err(Response::coded_error(
            "InteractionRequired",
            "Configured output requires interactive UI",
        ));
    }
    if command.confirm && !request.interactive {
        return Err(Response::coded_error(
            "ConfirmationRequired",
            "This command requires interactive confirmation",
        ));
    }
    if command.structured && !command.takes_text && request.input.is_none() {
        return Err(Response::coded_error(
            "InputRequired",
            "This command requires structured input",
        ));
    }
    if command.takes_text
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

fn start(app: &AppHandle, mut request: RunRequest, source: ActivationSource) -> ApiResult<Job> {
    if app.state::<AppState>().tool_catalog().is_none() {
        return Err(Response::coded_error(
            "NotReady",
            "Command execution tools are still loading",
        ));
    }
    let command = lookup(app, &request)?;
    validate_run(&command, &request)?;
    if request.replace {
        request.output = tyco_activation_protocol::OutputMode::Return;
    }
    let config = app.state::<AppState>().params().user_config;
    let selection = if request.selection {
        permission(&config, "selection")?;
        let (id, text) = selection_replace::prepare_external(app)
            .map_err(|error| Response::coded_error("SelectionFailed", error.to_string()))?;
        request.text = Some(text);
        // Retain the explicit selection capability for the authorization recheck.
        Some(id)
    } else {
        None
    };
    let jobs = app.state::<ExternalJobs>();
    let job = match jobs.create(command.id.clone(), request.clone(), selection) {
        Ok(job) => job,
        Err(error) => {
            if let Some(id) = selection {
                let _ = selection_replace::finish(app, id, None);
            }
            return Err(Response::coded_error("Busy", error));
        }
    };
    if let Some(raw) = config["commands"]
        .as_array()
        .and_then(|commands| commands.iter().find(|item| item["id"] == command.id))
    {
        jobs.remember_command(&job.id, raw.clone());
    }
    let needs_ui = (request.output == tyco_activation_protocol::OutputMode::Configured
        && (command.shows_menu || (command.replaces_selection && !request.replace)))
        || command.confirm
        || (command.takes_text && request.text.is_none() && request.input.is_none());
    let handoff = if needs_ui {
        let mut activation = Activation::new(StartMode::CommandLauncher, source);
        // External calls never capture a selection implicitly when opening UI.
        activation.selected_text = Some(String::new());
        activation.launcher_request = Some(external_commands::LauncherRequest {
            command_id: command.id.clone(),
            text: request.text.clone(),
            job_id: Some(job.id.clone()),
            output: request.output,
            input: request.input.clone(),
        });
        runtime::activate(app, activation).map_err(|error| error.to_string())
    } else {
        app.get_webview_window(runtime::QUICK_WINDOW_LABEL).ok_or_else(|| "Quick window not found".to_owned())
            .and_then(|window| window.emit(external_commands::COMMAND_RUN_EVENT, json!({
                "commandId": command.id, "jobId": job.id, "text": request.text, "input": request.input,
                "output": request.output, "userConfig": config,
            })).map_err(|error| error.to_string()))
    };
    if let Err(error) = handoff {
        complete(
            app,
            &job.id,
            JobCompletion {
                success: false,
                cancelled: false,
                output: None,
                message: Some(error.clone()),
                code: Some("Unavailable".into()),
            },
        );
        return Err(Response::coded_error("Unavailable", error));
    }
    Ok(job)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCompletion {
    pub success: bool,
    #[serde(default)]
    pub cancelled: bool,
    pub output: Option<String>,
    pub message: Option<String>,
    pub code: Option<String>,
}

pub fn complete(app: &AppHandle, id: &str, mut completion: JobCompletion) {
    if let (Some(input), Some(output)) = (
        app.state::<ExternalJobs>().selection_input(id),
        completion.output.as_mut(),
    ) {
        if !output.trim().is_empty() {
            *output = keep_selection_whitespace(&input, output);
        }
    }
    let state = if completion.cancelled {
        JobState::Cancelled
    } else if completion.success {
        JobState::Succeeded
    } else {
        JobState::Failed
    };
    let jobs = app.state::<ExternalJobs>();
    let code = completion.code.or_else(|| {
        if completion.cancelled {
            Some("Cancelled".into())
        } else if !completion.success {
            Some("ExecutionFailed".into())
        } else {
            None
        }
    });
    if let Some((job, Some(run_id), _)) =
        jobs.finish(id, state, completion.output, completion.message, code)
    {
        // The original target is retained even while a confirmation window is open.
        let replace = job.state == JobState::Succeeded && jobs_request_replace(app, id);
        let output = job.output.clone().filter(|text| !text.trim().is_empty());
        if replace {
            if let Some(window) = app.get_webview_window(runtime::QUICK_WINDOW_LABEL) {
                if window.is_focused().unwrap_or(false) {
                    let _ = window.hide();
                    runtime::wait_until_unfocused(app, std::time::Duration::from_millis(300));
                }
            }
        }
        let result =
            selection_replace::finish(app, run_id, if replace { output.clone() } else { None });
        let error = match result {
            Err(error) => Some(error.to_string()),
            Ok(selection_replace::FinishStatus::Clipboard) if replace => {
                Some("Focus changed; result is in the clipboard".into())
            }
            Ok(selection_replace::FinishStatus::Stale) if replace => {
                Some("Selection target is no longer available".into())
            }
            _ if replace && output.is_none() => {
                Some("Command returned no text to replace the selection".into())
            }
            _ => None,
        };
        jobs.publish_selection(id, error);
    }
}

fn keep_selection_whitespace(input: &str, output: &str) -> String {
    let leading = &input[..input.len() - input.trim_start().len()];
    let trailing = &input[input.trim_end().len()..];
    format!("{leading}{}{trailing}", output.trim())
}

fn jobs_request_replace(app: &AppHandle, id: &str) -> bool {
    app.state::<ExternalJobs>().replace_requested(id)
}

fn cancel(app: &AppHandle, id: &str, code: &str) -> Response {
    let jobs = app.state::<ExternalJobs>();
    let Some(job) = jobs.get(id) else {
        return Response::coded_error("NotFound", "No such job");
    };
    if !job.state.is_terminal() {
        complete(
            app,
            id,
            JobCompletion {
                success: false,
                cancelled: true,
                output: None,
                message: Some(code.into()),
                code: Some(code.into()),
            },
        );
        if let Some(window) = app.get_webview_window(runtime::QUICK_WINDOW_LABEL) {
            let _ = window.emit(JOB_CANCEL_EVENT, id);
        }
    }
    Response::json(&jobs.get(id))
}

pub fn claim(app: &AppHandle, id: &str) -> bool {
    let jobs = app.state::<ExternalJobs>();
    let Some((command_id, mut request)) = jobs.claim(id) else {
        return false;
    };
    request.target = command_id.clone();
    request.by_name = false;
    if let Err(error) = lookup(app, &request) {
        complete(
            app,
            id,
            JobCompletion {
                success: false,
                cancelled: false,
                output: None,
                message: error.error,
                code: error.code,
            },
        );
        return false;
    }
    let config = app.state::<AppState>().params().user_config;
    if request.selection {
        if let Err(error) = permission(&config, "selection") {
            complete(
                app,
                id,
                JobCompletion {
                    success: false,
                    cancelled: false,
                    output: None,
                    message: error.error,
                    code: error.code,
                },
            );
            return false;
        }
    }
    let current = config["commands"]
        .as_array()
        .and_then(|commands| commands.iter().find(|item| item["id"] == command_id));
    if !jobs.command_unchanged(id, current) {
        complete(
            app,
            id,
            JobCompletion {
                success: false,
                cancelled: false,
                output: None,
                message: Some("Command configuration changed before execution".into()),
                code: Some("ConfigurationChanged".into()),
            },
        );
        return false;
    }
    true
}

/// Expires abandoned UI requests even when no external client polls them.
pub fn spawn_reaper(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let ids = app.state::<ExternalJobs>().expired();
            for id in ids {
                let app = app.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || cancel(&app, &id, "TimedOut"))
                    .await;
            }
        }
    });
}

pub fn dispatch(app: &AppHandle, request: Request, source: ActivationSource) -> Response {
    let response = dispatch_inner(app, request, source);
    if serde_json::to_vec(&response).map_or(true, |bytes| {
        bytes.len() >= tyco_activation_protocol::MAX_MESSAGE_BYTES
    }) {
        Response::coded_error("OutputTooLarge", "Serialized response is too large")
    } else {
        response
    }
}

fn dispatch_inner(app: &AppHandle, request: Request, source: ActivationSource) -> Response {
    if serde_json::to_vec(&request).map_or(true, |bytes| {
        bytes.len() >= tyco_activation_protocol::MAX_MESSAGE_BYTES
    }) {
        return Response::coded_error("InvalidInput", "Protocol message is too large");
    }
    for id in app.state::<ExternalJobs>().expired() {
        cancel(app, &id, "TimedOut");
    }
    match request {
        Request::Status => {
            let config = app.state::<AppState>().params().user_config;
            Response::json(
                &json!({ "apiVersion": API_VERSION, "running": true, "externalAccess": {
                "commands": access_allowed(&config, "commands"),
                "selection": access_allowed(&config, "selection"),
                "recording": access_allowed(&config, "recording"),
            } }),
            )
        }
        Request::ListCommands => {
            let state = app.state::<AppState>();
            let config = state.params().user_config;
            if !access_allowed(&config, "commands") {
                return Response::output("[]");
            }
            Response::output(external_commands::list(
                &config,
                state.tool_catalog().as_ref(),
            ))
        }
        Request::DescribeCommand { target, by_name } => {
            let request = RunRequest {
                target,
                by_name,
                ..Default::default()
            };
            match lookup(app, &request) {
                Ok(command) => {
                    let config = app.state::<AppState>().params().user_config;
                    let raw = config["commands"]
                        .as_array()
                        .and_then(|commands| commands.iter().find(|item| item["id"] == command.id));
                    Response::json(
                        &json!({"id":command.id, "name":raw.and_then(|item| item.get("name")), "input":if command.structured {"structured"} else if command.takes_text {"text"} else {"none"}, "textAccepted":command.takes_text, "confirmationRequired":command.confirm, "canReplaceSelection":command.takes_text && !command.structured, "afterRun":raw.and_then(|item| item.get("afterRun")), "inputSchema":app.state::<AppState>().tool_catalog().as_ref().and_then(|catalog| raw.and_then(|raw|raw["toolId"].as_str()).and_then(|id|catalog.get(id))).and_then(|tool|tool.input_schema.clone()) }),
                    )
                }
                Err(error) => error,
            }
        }
        Request::Run { request } => match start(app, request, source) {
            Ok(job) => Response::json(&job),
            Err(error) => error,
        },
        Request::JobStatus { id } => app
            .state::<ExternalJobs>()
            .get(&id)
            .map(|job| Response::json(&job))
            .unwrap_or_else(|| Response::coded_error("NotFound", "No such job")),
        Request::JobCancel { id } => cancel(app, &id, "Cancelled"),
        Request::Replace { action } => {
            let config = app.state::<AppState>().params().user_config;
            if let Err(error) = permission(&config, "selection") {
                return error;
            }
            if let Some(id) = action.strip_prefix(tyco_activation_protocol::COMMAND_ACTION_PREFIX) {
                return dispatch(
                    app,
                    Request::Run {
                        request: RunRequest {
                            target: id.into(),
                            selection: true,
                            replace: true,
                            interactive: true,
                            ..Default::default()
                        },
                    },
                    source,
                );
            }
            Response::coded_error("InvalidArgs", "Use command:<id> for selection actions")
        }

        Request::Open {
            mode,
            text,
            selection,
        } => {
            let mode = tyco_activation_protocol::canonical_mode(&mode).to_owned();
            let config = app.state::<AppState>().params().user_config;
            if selection {
                if let Err(error) = permission(&config, "selection") {
                    return error;
                }
            }
            if selection && text.is_some() {
                return Response::coded_error("InvalidInput", "Choose text or selection");
            }
            if matches!(mode.as_str(), "voice" | "voiceChat" | "write") {
                if let Err(error) = permission(&config, "recording") {
                    return error;
                }
            }
            match StartMode::parse(&mode) {
                Ok(mode) => {
                    let mut activation = Activation::new(mode, source);
                    activation.selected_text = if selection {
                        match selection_replace::prepare_external(app) {
                            Ok((id, text)) => {
                                let _ = selection_replace::finish(app, id, None);
                                Some(text)
                            }
                            Err(error) => {
                                return Response::coded_error("SelectionFailed", error.to_string())
                            }
                        }
                    } else {
                        Some(text.unwrap_or_default())
                    };
                    match runtime::activate(app, activation) {
                        Ok(()) => Response::success(),
                        Err(error) => Response::error(error.to_string()),
                    }
                }
                Err(error) => Response::coded_error("InvalidArgs", error.to_string()),
            }
        }
        Request::Quit => {
            app.state::<AppState>().set_quitting(true);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                app.exit(0);
            });
            Response::success()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command() -> ExternalCommand {
        ExternalCommand {
            id: "test".into(),
            takes_text: true,
            structured: false,
            confirm: false,
            shows_menu: false,
            replaces_selection: false,
        }
    }
    #[test]
    fn automation_requires_explicit_input_and_confirmation() {
        let mut command = command();
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
        command.confirm = true;
        assert_eq!(
            validate_run(&command, &request)
                .unwrap_err()
                .code
                .as_deref(),
            Some("ConfirmationRequired")
        );
        request.interactive = true;
        assert!(validate_run(&command, &request).is_ok());
        request.selection = true;
        assert!(validate_run(&command, &request).is_err());
    }
    #[test]
    fn permission_defaults_deny_capture() {
        assert!(permission(&json!({}), "commands").is_ok());
        assert!(permission(&json!({}), "selection").is_err());
        assert!(permission(&json!({}), "recording").is_err());
        assert!(permission(&json!({"externalAccess":{"commands":"false"}}), "commands").is_err());
        assert!(permission(&json!({"externalAccess":null}), "commands").is_err());
        assert!(permission(&json!({"externalAccess":{"commands":false}}), "commands").is_err());
    }
    #[test]
    fn replacement_preserves_original_surrounding_whitespace() {
        assert_eq!(
            keep_selection_whitespace("  source\n\n", " result\n"),
            "  result\n\n"
        );
        assert_eq!(
            keep_selection_whitespace("\u{2003}source\t", "changed"),
            "\u{2003}changed\t"
        );
    }
}
