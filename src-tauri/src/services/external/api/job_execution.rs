use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tyco_activation_protocol::{ErrorCode, Job, JobState, Response, RunRequest};

use super::validation::{
    command_name, ensure_selection_access_allowed, is_selection_access_allowed, lookup,
    raw_command, validate_run,
};
use super::ApiResult;
use crate::errors::AppError;
use crate::events;
use crate::services::activation::{Activation, ActivationMode, ActivationSource};
use crate::services::external::access::{self, AccessPrompt, AccessPromptError, AccessRequest};
use crate::services::external::command_library::{self, ExternalCommand};
use crate::services::external::jobs::ExternalJobs;
use crate::services::{runtime, selection_replace};
use crate::state::AppState;

const PROMPT_BUSY: &str = "Another request for the selection is waiting for an answer";

#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct JobCompletion {
    #[serde(rename = "success")]
    pub is_success: bool,
    #[serde(default, rename = "cancelled")]
    #[ts(as = "Option<bool>", optional)]
    pub is_cancelled: bool,
    pub output: Option<String>,
    pub message: Option<String>,
    pub code: Option<String>,
}

pub(super) fn start(
    app: &AppHandle,
    mut request: RunRequest,
    source: ActivationSource,
) -> ApiResult<Job> {
    if app
        .state::<crate::services::external::command_library::ToolCatalogState>()
        .get()
        .is_none()
    {
        return Err(Box::new(Response::coded_error(
            ErrorCode::NotReady,
            "Command execution tools are still loading",
        )));
    }
    let command = lookup(app, &request.target, request.by_name)?;
    validate_run(&command, &request)?;
    let config = app.state::<AppState>().user_config();
    // without the permission the user is asked, see `external_access`
    let ask = request.selection && !is_selection_access_allowed(&config);
    // checked again when the prompt is taken; this saves the capture
    if ask && app.state::<AccessPrompt>().is_pending() {
        return Err(Box::new(Response::coded_error(
            ErrorCode::AccessDenied,
            PROMPT_BUSY,
        )));
    }
    let selection = if request.selection {
        // taken before the prompt, which moves the focus away from it
        let (id, text) = selection_replace::prepare_external(app).map_err(|error| {
            Response::coded_error(ErrorCode::SelectionFailed, error.to_string())
        })?;
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
                selection_replace::release(app, id);
            }
            return Err(Box::new(Response::coded_error(ErrorCode::Busy, error)));
        }
    };
    if let Some(raw) = raw_command(&config, &command.id) {
        jobs.remember_command(&job.id, raw.clone());
    }
    if ask {
        let prompt = AccessRequest {
            job_id: job.id.clone(),
            command_name: command_name(&config, &command.id),
            should_replace: request.replace,
        };
        let (code, message) = match access::ask(app, prompt, source) {
            Ok(()) => return Ok(job),
            Err(AccessPromptError::Busy) => (ErrorCode::AccessDenied, String::from(PROMPT_BUSY)),
            Err(AccessPromptError::Failed(error)) => (ErrorCode::Unavailable, error.to_string()),
        };
        // also gives the selection run its clipboard back
        fail(app, &job.id, message.clone(), code);
        return Err(Box::new(Response::coded_error(code, message)));
    }
    hand_off(app, &job.id, &command, &request, source)?;
    Ok(job)
}

fn fail(app: &AppHandle, id: &str, message: String, code: ErrorCode) {
    complete(
        app,
        id,
        JobCompletion {
            is_success: false,
            is_cancelled: false,
            output: None,
            message: Some(message),
            code: Some(code.into()),
        },
    );
}

/// Gives an accepted job to the quick window: to the command overlay when it
/// still needs input, to the background runner otherwise.
fn hand_off(
    app: &AppHandle,
    job_id: &str,
    command: &ExternalCommand,
    request: &RunRequest,
    source: ActivationSource,
) -> ApiResult<()> {
    let config = app.state::<AppState>().user_config();
    let needs_ui = command.can_take_text && request.text.is_none() && request.input.is_none();
    let handoff = if needs_ui {
        let mut activation = Activation::new(ActivationMode::CommandLauncher, source);
        // External calls never capture a selection implicitly when opening UI.
        activation.selected_text = Some(String::new());
        activation.launcher_request = Some(command_library::LauncherRequest {
            command_id: command.id.clone(),
            text: request.text.clone(),
            job_id: Some(job_id.to_owned()),
            input: request.input.clone(),
        });
        runtime::activate(app, activation).map_err(|error| error.to_string())
    } else {
        app.get_webview_window(runtime::QUICK_WINDOW_LABEL)
            .ok_or_else(|| "Quick window not found".to_owned())
            .and_then(|window| {
                events::emit::<events::CommandRun, _>(
                    &window,
                    events::CommandRunEvent {
                        command_id: command.id.clone(),
                        job_id: job_id.to_owned(),
                        text: request.text.clone(),
                        input: request.input.clone(),
                        user_config: config,
                    },
                )
                .map_err(|error| error.to_string())
            })
    };
    handoff.map_err(|error| {
        fail(app, job_id, error.clone(), ErrorCode::Unavailable);
        Box::new(Response::coded_error(ErrorCode::Unavailable, error))
    })
}

/// Runs a job the user allowed to use the selection, unless it ended or its
/// command went away while the prompt was shown.
pub fn resume(app: &AppHandle, job_id: &str, source: ActivationSource) {
    let Some(request) = app.state::<ExternalJobs>().accepted_request(job_id) else {
        return;
    };
    let command = match lookup(app, &request.target, request.by_name) {
        Ok(command) => command,
        Err(error) => {
            complete(
                app,
                job_id,
                JobCompletion {
                    is_success: false,
                    is_cancelled: false,
                    output: None,
                    message: error.error,
                    code: error.code,
                },
            );
            return;
        }
    };
    // a failed handoff has completed the job with its error already
    let _ = hand_off(app, job_id, &command, &request, source);
}

/// The user did not allow the job to use the selection.
pub fn deny_selection(app: &AppHandle, job_id: &str) {
    fail(
        app,
        job_id,
        "The user did not allow access to the selection".into(),
        ErrorCode::AccessDenied,
    );
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
    let state = if completion.is_cancelled {
        JobState::Cancelled
    } else if completion.is_success {
        JobState::Succeeded
    } else {
        JobState::Failed
    };
    let jobs = app.state::<ExternalJobs>();
    let code = completion.code.or_else(|| {
        if completion.is_cancelled {
            Some(ErrorCode::Cancelled.into())
        } else if !completion.is_success {
            Some(ErrorCode::ExecutionFailed.into())
        } else {
            None
        }
    });
    if let Some((job, Some(run_id))) =
        jobs.finish(id, state, completion.output, completion.message, code)
    {
        // The original target is retained even while the command launcher is open.
        let replace = job.state == JobState::Succeeded && jobs_request_replace(app, id);
        let output = job.output.clone().filter(|text| !text.trim().is_empty());
        if replace {
            if let Some(window) = app.get_webview_window(runtime::QUICK_WINDOW_LABEL) {
                if window.is_focused().unwrap_or(false) {
                    let _ = window.hide();
                    runtime::wait_until_unfocused(app, runtime::FOCUS_RELEASE_TIMEOUT);
                }
            }
        }
        let result =
            selection_replace::finish(app, run_id, if replace { output.clone() } else { None });
        let error = match result {
            Err(error) => Some(error.to_string()),
            Ok(selection_replace::SelectionFinishStatus::CopiedToClipboard) if replace => {
                Some("Focus changed; result is in the clipboard".into())
            }
            Ok(selection_replace::SelectionFinishStatus::Stale) if replace => {
                Some("Selection target is no longer available".into())
            }
            _ if replace && output.is_none() => {
                Some("Command returned no text to replace the selection".into())
            }
            _ => None,
        };
        jobs.complete_selection_replacement(id, error);
    }
}

fn keep_selection_whitespace(input: &str, output: &str) -> String {
    let leading = &input[..input.len() - input.trim_start().len()];
    // taken from what follows the leading part: an input of blanks alone
    // would otherwise give them twice
    let rest = &input[leading.len()..];
    let trailing = &rest[rest.trim_end().len()..];
    format!("{leading}{}{trailing}", output.trim())
}

fn jobs_request_replace(app: &AppHandle, id: &str) -> bool {
    app.state::<ExternalJobs>()
        .is_selection_replacement_requested(id)
}

pub(super) fn cancel(app: &AppHandle, id: &str, code: ErrorCode) -> Response {
    let jobs = app.state::<ExternalJobs>();
    let Some(job) = jobs.get(id) else {
        return Response::coded_error(ErrorCode::NotFound, "No such job");
    };
    if !job.state.is_terminal() {
        access::withdraw(app, id);
        complete(
            app,
            id,
            JobCompletion {
                is_success: false,
                is_cancelled: true,
                output: None,
                message: Some(code.into()),
                code: Some(code.into()),
            },
        );
        if let Some(window) = app.get_webview_window(runtime::QUICK_WINDOW_LABEL) {
            let _ = events::emit::<events::ExternalJobCancel, _>(&window, id.to_owned());
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
                is_success: false,
                is_cancelled: false,
                output: None,
                message: error.error,
                code: error.code,
            },
        );
        return false;
    }
    let config = app.state::<AppState>().user_config();
    if request.selection && !jobs.is_selection_approved(id) {
        if let Err(error) = ensure_selection_access_allowed(&config) {
            complete(
                app,
                id,
                JobCompletion {
                    is_success: false,
                    is_cancelled: false,
                    output: None,
                    message: error.error,
                    code: error.code,
                },
            );
            return false;
        }
    }
    if !jobs.is_command_unchanged(id, raw_command(&config, &command_id)) {
        complete(
            app,
            id,
            JobCompletion {
                is_success: false,
                is_cancelled: false,
                output: None,
                message: Some("Command configuration changed before execution".into()),
                code: Some(ErrorCode::ConfigurationChanged.into()),
            },
        );
        return false;
    }
    true
}

/// Expires abandoned UI requests even when no external client polls them.
pub fn spawn_reaper(app: AppHandle) -> Result<(), AppError> {
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    services.spawn_async(async move {
        let app = handle;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let maintenance_app = app.clone();
            let _ = app
                .state::<crate::services::background::BackgroundServices>()
                .run_blocking(move || {
                    let state = maintenance_app.state::<AppState>();
                    state.history.retry_cleanup(&maintenance_app, &state);
                })
                .await;
            let ids = app.state::<ExternalJobs>().expired_job_ids();
            for id in ids {
                let handle = app.clone();
                let _ = app
                    .state::<crate::services::background::BackgroundServices>()
                    .run_blocking(move || cancel(&handle, &id, ErrorCode::TimedOut))
                    .await;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::keep_selection_whitespace;

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
        assert_eq!(keep_selection_whitespace("  \n", "text"), "  \ntext");
    }
}
