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

/// Selection capture is opt-in; which commands run from
/// outside is decided by each command's own grant.
fn access_allowed(config: &Value, capability: &str) -> bool {
    config
        .pointer(&format!("/externalAccess/{capability}"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
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

fn lookup(app: &AppHandle, target: &str, by_name: bool) -> ApiResult<ExternalCommand> {
    let state = app.state::<AppState>();
    let config = state.params().user_config;
    let catalog = state.tool_catalog();
    if by_name {
        external_commands::find_by_name(&config, catalog.as_ref(), target)
    } else {
        external_commands::find_by_id(&config, catalog.as_ref(), target)
    }
    .map_err(lookup_error)
}

/// The command `id` as the user config holds it.
fn raw_command<'a>(config: &'a Value, id: &str) -> Option<&'a Value> {
    config["commands"]
        .as_array()
        .and_then(|commands| commands.iter().find(|item| item["id"] == id))
}

fn describe(app: &AppHandle, target: &str, by_name: bool) -> ApiResult<Value> {
    let command = lookup(app, target, by_name)?;
    let state = app.state::<AppState>();
    let config = state.params().user_config;
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
        "input": if command.structured {
            "structured"
        } else if command.takes_text {
            "text"
        } else {
            "none"
        },
        "textAccepted": command.takes_text,
        "canReplaceSelection": command.takes_text && !command.structured,
        "output": "return",
        "inputSchema": input_schema,
    }))
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
    let command = lookup(app, &request.target, request.by_name)?;
    validate_run(&command, &request)?;
    // Keep accepting legacy configured output requests, but external calls
    // always return output; only the caller can request a selection replacement.
    request.output = tyco_activation_protocol::OutputMode::Return;
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
    if let Some(raw) = raw_command(&config, &command.id) {
        jobs.remember_command(&job.id, raw.clone());
    }
    let needs_ui = command.takes_text && request.text.is_none() && request.input.is_none();
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
        // The original target is retained even while the command launcher is open.
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
    let Some((command_id, request)) = jobs.claim(id) else {
        return false;
    };
    if let Err(error) = lookup(app, &command_id, false) {
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
    if !jobs.command_unchanged(id, raw_command(&config, &command_id)) {
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

fn open(
    app: &AppHandle,
    mode: &str,
    text: Option<String>,
    selection: bool,
    source: ActivationSource,
) -> ApiResult<()> {
    let mode = StartMode::parse(mode)
        .map_err(|error| Response::coded_error("InvalidArgs", error.to_string()))?;
    if selection && text.is_some() {
        return Err(Response::coded_error(
            "InvalidInput",
            "Choose text or selection",
        ));
    }
    let config = app.state::<AppState>().params().user_config;
    if selection {
        permission(&config, "selection")?;
    }
    let mut activation = Activation::new(mode, source);
    activation.selected_text = if selection {
        let (id, text) = selection_replace::prepare_external(app)
            .map_err(|error| Response::coded_error("SelectionFailed", error.to_string()))?;
        let _ = selection_replace::finish(app, id, None);
        Some(text)
    } else {
        text
    };
    runtime::activate(app, activation).map_err(|error| Response::error(error.to_string()))
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
            Response::json(&json!({
                "apiVersion": API_VERSION,
                "version": app.package_info().version.to_string(),
                "running": true,
                "externalAccess": {
                    "selection": access_allowed(&config, "selection"),
                },
            }))
        }
        // Each command carries its own grant, so the list holds the granted ones.
        Request::ListCommands => {
            let state = app.state::<AppState>();
            let config = state.params().user_config;
            Response::json(&external_commands::list(
                &config,
                state.tool_catalog().as_ref(),
            ))
        }
        Request::DescribeCommand { target, by_name } => match describe(app, &target, by_name) {
            Ok(description) => Response::json(&description),
            Err(error) => error,
        },
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
        Request::Open {
            mode,
            text,
            selection,
        } => match open(app, &mode, text, selection, source) {
            Ok(()) => Response::success(),
            Err(error) => error,
        },
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
    fn legacy_configured_output_does_not_require_interactive_ui() {
        let request = RunRequest {
            target: "test".into(),
            text: Some("input".into()),
            output: tyco_activation_protocol::OutputMode::Configured,
            ..Default::default()
        };
        assert!(validate_run(&command(), &request).is_ok());
    }

    #[test]
    fn permission_defaults_deny_capture() {
        assert!(permission(&json!({}), "selection").is_err());
        assert!(permission(&json!({"externalAccess":null}), "selection").is_err());
        assert!(permission(&json!({"externalAccess":{"selection":"true"}}), "selection").is_err());
        assert!(permission(&json!({"externalAccess":{"selection":true}}), "selection").is_ok());
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
