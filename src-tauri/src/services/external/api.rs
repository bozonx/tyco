//! The authorization and dispatch boundary shared by D-Bus and local IPC.

mod job_execution;
mod validation;

pub use job_execution::{
    abandon_active, cancel_quiet_on_shutdown, claim, complete, deny_selection, spawn_reaper,
    start_internal, CommandRunPayload, JobCompletion,
};

use self::job_execution::{cancel, start};
use self::validation::{describe, ensure_selection_access_allowed, is_selection_access_allowed};

use serde_json::json;
use tauri::{AppHandle, Manager};
use tyco_activation_protocol::{ErrorCode, Request, Response, API_VERSION};

use crate::services::activation::{Activation, ActivationSource};
use crate::services::external::command_library;
use crate::services::external::jobs::ExternalJobs;
use crate::services::{runtime, selection_replace, visible_work};
use crate::state::AppState;

/// A failed request answers with a `Response` of its own; boxed, as it is large.
type ApiResult<T> = Result<T, Box<Response>>;

fn open(
    app: &AppHandle,
    mode: &str,
    text: Option<String>,
    selection: bool,
    source: ActivationSource,
) -> ApiResult<()> {
    if selection && text.is_some() {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InvalidInput,
            "Choose text or selection",
        )));
    }
    let config = app.state::<AppState>().user_config();
    if selection {
        ensure_selection_access_allowed(&config)?;
    }
    visible_work::end(app);
    let mut activation = Activation::from_mode(mode, source)
        .map_err(|error| Response::coded_error(ErrorCode::InvalidInput, error.to_string()))?;
    activation.selected_text = if selection {
        Some(selection_replace::read_external(app).map_err(|error| {
            Response::coded_error(ErrorCode::SelectionFailed, error.to_string())
        })?)
    } else {
        text
    };
    runtime::activate(app, activation).map_err(|error| Box::new(Response::error(error.to_string())))
}

/// Corrects the selection of the focused window in place, as the inline
/// correction hotkey does. The shortcut that started the call may still be
/// held, so the capture waits for its keys to be released.
fn replace_selection(app: &AppHandle, action: &str) -> ApiResult<()> {
    if action != selection_replace::CORRECTION_ACTION {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InvalidInput,
            format!("Unknown selection action: {action}"),
        )));
    }
    let config = app.state::<AppState>().user_config();
    ensure_selection_access_allowed(&config)?;
    selection_replace::trigger(
        app,
        action,
        selection_replace::TriggerWait::Delay(selection_replace::SHORTCUT_RELEASE_DELAY),
    )
    .map_err(|error| {
        Box::new(Response::coded_error(
            ErrorCode::SelectionFailed,
            error.to_string(),
        ))
    })
}

/// Whether the window may run jobs: only the quick window, which shows the
/// command overlay, does.
pub fn is_job_window(window_label: &str) -> bool {
    window_label == runtime::QUICK_WINDOW_LABEL
}

fn ensure_job_window(window_label: &str, action: &str) -> Result<(), crate::errors::AppError> {
    if is_job_window(window_label) {
        Ok(())
    } else {
        Err(crate::errors::AppError::InvalidInput(format!(
            "Only the quick window {action}"
        )))
    }
}

/// Hands the job over to the window; `None` when it is not the job window
/// or the job is gone, taken or over.
pub fn claim_for_window(
    app: &AppHandle,
    window_label: &str,
    id: &str,
) -> Option<CommandRunPayload> {
    if owns_job(&app.state::<ExternalJobs>(), window_label, id) {
        claim(app, id)
    } else {
        None
    }
}

pub fn supply_input_for_window(
    jobs: &ExternalJobs,
    window_label: &str,
    id: &str,
    text: String,
) -> Result<(), crate::errors::AppError> {
    ensure_job_window(window_label, "provides command run input")?;
    jobs.supply_input(id, text);
    Ok(())
}

fn owns_job(jobs: &ExternalJobs, label: &str, id: &str) -> bool {
    label
        == if jobs.is_quiet(id) {
            runtime::QUIET_WINDOW_LABEL
        } else {
            runtime::QUICK_WINDOW_LABEL
        }
}

fn ensure_cancel_window(
    jobs: &ExternalJobs,
    window_label: &str,
    id: &str,
) -> Result<(), crate::errors::AppError> {
    if window_label == runtime::MAIN_WINDOW_LABEL && jobs.is_quiet(id) {
        return Ok(());
    }
    if owns_job(jobs, window_label, id) {
        Ok(())
    } else {
        Err(crate::errors::AppError::InvalidInput(
            "The job belongs to another window".into(),
        ))
    }
}

/// Cancels the run of the window, as Esc in its overlay does.
pub fn cancel_for_window(
    app: &AppHandle,
    window_label: &str,
    id: &str,
) -> Result<(), crate::errors::AppError> {
    ensure_cancel_window(&app.state::<ExternalJobs>(), window_label, id)?;
    cancel(app, id, ErrorCode::Cancelled);
    Ok(())
}

/// Finishes the job the window ran and returns it as it ended up.
pub fn finish_for_window(
    app: &AppHandle,
    window_label: &str,
    id: &str,
    completion: JobCompletion,
) -> Result<Option<tyco_activation_protocol::Job>, crate::errors::AppError> {
    if !owns_job(&app.state::<ExternalJobs>(), window_label, id) {
        return Err(crate::errors::AppError::InvalidInput(
            "The job belongs to another window".into(),
        ));
    }
    complete(app, id, completion);
    Ok(app.state::<ExternalJobs>().get(id))
}

/// Answers an access request of a job from the window.
pub fn answer_access_for_window(
    app: &AppHandle,
    window_label: &str,
    job_id: &str,
    decision: crate::services::external::access::AccessDecision,
) -> Result<(), crate::errors::AppError> {
    ensure_job_window(window_label, "answers access requests")?;
    crate::services::external::access::answer(app, job_id, decision)
}

pub fn dispatch(app: &AppHandle, request: Request, source: ActivationSource) -> Response {
    let response = dispatch_inner(app, request, source);
    if serde_json::to_vec(&response).map_or(true, |bytes| {
        bytes.len() >= tyco_activation_protocol::MAX_MESSAGE_BYTES
    }) {
        Response::coded_error(
            ErrorCode::OutputTooLarge,
            "Serialized response is too large",
        )
    } else {
        response
    }
}

fn dispatch_inner(app: &AppHandle, request: Request, source: ActivationSource) -> Response {
    if serde_json::to_vec(&request).map_or(true, |bytes| {
        bytes.len() >= tyco_activation_protocol::MAX_MESSAGE_BYTES
    }) {
        return Response::coded_error(ErrorCode::InvalidInput, "Protocol message is too large");
    }
    match request {
        Request::Status => {
            let config = app.state::<AppState>().user_config();
            Response::json(&json!({
                "apiVersion": API_VERSION,
                "version": app.package_info().version.to_string(),
                "running": true,
                "externalAccess": {
                    "selection": is_selection_access_allowed(&config),
                },
            }))
        }
        // Each command carries its own grant, so the list holds the granted ones.
        Request::ListCommands => {
            let config = app.state::<AppState>().user_config();
            let catalog = app.state::<command_library::OperationCatalogState>().get();
            Response::json(&command_library::list(&config, catalog.as_ref()))
        }
        Request::DescribeCommand { target, by_name } => match describe(app, &target, by_name) {
            Ok(description) => Response::json(&description),
            Err(error) => *error,
        },
        Request::Run { request } => match start(app, request, source) {
            Ok(job) => Response::json(&job),
            Err(error) => *error,
        },
        Request::ReplaceSelection { action } => match replace_selection(app, &action) {
            Ok(()) => Response::success(),
            Err(error) => *error,
        },
        Request::JobStatus { id } => app
            .state::<ExternalJobs>()
            .get(&id)
            .map(|job| Response::json(&job))
            .unwrap_or_else(|| Response::coded_error(ErrorCode::NotFound, "No such job")),
        Request::JobCancel { id } => cancel(app, &id, ErrorCode::Cancelled),
        Request::Open {
            mode,
            text,
            selection,
            activation_token,
        } => {
            // the window shown for this request takes it
            if let Some(token) = activation_token {
                crate::services::platform::offer_activation_token(token);
            }
            match open(app, &mode, text, selection, source) {
                Ok(()) => Response::success(),
                Err(error) => *error,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::external::jobs::NewJob;

    #[test]
    fn main_can_cancel_a_quiet_job_only() {
        let jobs = ExternalJobs::default();
        let create = |quiet| {
            jobs.create(NewJob {
                command_id: "fixture".into(),
                command_name: "Fixture".into(),
                request: tyco_activation_protocol::RunRequest {
                    quiet,
                    ..Default::default()
                },
                is_internal: false,
                command_snapshot: None,
            })
            .unwrap()
        };
        let visible = create(false);
        let quiet = create(true);
        assert!(ensure_cancel_window(&jobs, runtime::MAIN_WINDOW_LABEL, &quiet.id).is_ok());
        assert!(ensure_cancel_window(&jobs, runtime::MAIN_WINDOW_LABEL, &visible.id).is_err());
        assert!(ensure_cancel_window(&jobs, runtime::QUICK_WINDOW_LABEL, &visible.id).is_ok());
        assert!(ensure_cancel_window(&jobs, "subtitles", &quiet.id).is_err());
    }
}
