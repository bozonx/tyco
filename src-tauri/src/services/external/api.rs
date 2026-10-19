//! The authorization and dispatch boundary shared by D-Bus and local IPC.

mod job_execution;
mod validation;

pub use job_execution::{claim, complete, deny_selection, resume, spawn_reaper, JobCompletion};

use self::job_execution::{cancel, start};
use self::validation::{describe, ensure_selection_access_allowed, is_selection_access_allowed};

use serde_json::json;
use tauri::{AppHandle, Manager};
use tyco_activation_protocol::{ErrorCode, Request, Response, API_VERSION};

use crate::services::activation::{Activation, ActivationMode, ActivationSource};
use crate::services::external::commands;
use crate::services::external::jobs::ExternalJobs;
use crate::services::{runtime, selection_replace};
use crate::state::AppState;

pub const JOB_CANCEL_EVENT: &str = "app://external-job-cancel";

/// A failed request answers with a `Response` of its own; boxed, as it is large.
type ApiResult<T> = Result<T, Box<Response>>;

fn open(
    app: &AppHandle,
    mode: &str,
    text: Option<String>,
    selection: bool,
    source: ActivationSource,
) -> ApiResult<()> {
    let mode = ActivationMode::parse(mode)
        .map_err(|error| Response::coded_error(ErrorCode::InvalidInput, error.to_string()))?;
    if selection && text.is_some() {
        return Err(Box::new(Response::coded_error(
            ErrorCode::InvalidInput,
            "Choose text or selection",
        )));
    }
    let config = app.state::<AppState>().snapshot().settings.user_config;
    if selection {
        ensure_selection_access_allowed(&config)?;
    }
    let mut activation = Activation::new(mode, source);
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
    let config = app.state::<AppState>().snapshot().settings.user_config;
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
    for id in app.state::<ExternalJobs>().expired_job_ids() {
        cancel(app, &id, ErrorCode::TimedOut);
    }
    match request {
        Request::Status => {
            let config = app.state::<AppState>().snapshot().settings.user_config;
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
            let config = app.state::<AppState>().snapshot().settings.user_config;
            let catalog = app.state::<commands::ToolCatalogState>().get();
            Response::json(&commands::list(&config, catalog.as_ref()))
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
        } => match open(app, &mode, text, selection, source) {
            Ok(()) => Response::success(),
            Err(error) => *error,
        },
        Request::Quit => {
            let app = app.clone();
            let services = app.state::<crate::services::background::BackgroundServices>();
            let handle = app.clone();
            if let Err(error) = services.spawn_async(async move {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                handle.exit(0);
            }) {
                return Response::coded_error(ErrorCode::Unavailable, error.to_string());
            }
            Response::success()
        }
    }
}
