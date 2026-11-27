use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};
use tyco_activation_protocol::{ErrorCode, Job, JobState, Response, RunRequest};

use super::validation::{
    command_name, ensure_selection_access_allowed, is_selection_access_allowed, lookup,
    raw_command, validate_run,
};
use super::ApiResult;
use crate::errors::AppError;
use crate::events;
use crate::models::{
    EditorHistoryEntry, EditorHistoryFailure, EditorHistoryFailureKind, EditorHistoryKind,
    EditorHistoryOrigin,
};
use crate::services::activation::{
    Activation, ActivationMode, ActivationSource, CommandRunRequest,
};
use crate::services::external::jobs::{CreateJobError, ExternalJobs, NewJob, RunHistory};
use crate::services::external::{access, command_library};
use crate::services::{runtime, selection_replace, visible_work};
use crate::state::AppState;

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

/// What the command overlay runs once it has taken the job.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunPayload {
    pub command_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, unknown>")]
    pub input: Option<Map<String, Value>>,
    /// The selection the call captured, for `{{SELECTION}}`; it is the text
    /// too, see `RunRequest::selection`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub selection_text: Option<String>,
    /// The quick window does not receive config changes made elsewhere.
    #[ts(type = "UserConfig")]
    pub user_config: std::sync::Arc<Value>,
}

/// Takes the run slot for `command_name`; a refused run is told in the
/// overlay of the running one.
fn reserve(app: &AppHandle, new_job: NewJob) -> Result<Job, CreateJobError> {
    let command_name = new_job.command_name.clone();
    let quiet = new_job.request.quiet;
    app.state::<ExternalJobs>()
        .create(new_job)
        .inspect_err(|error| {
            if quiet {
                return;
            }
            if let CreateJobError::Busy {
                running_command_name,
            } = error
            {
                let _ = events::emit_to::<events::CommandRunRejected, _>(
                    app,
                    runtime::QUICK_WINDOW_LABEL,
                    events::CommandRunRejectedEvent {
                        command_name,
                        running_command_name: running_command_name.clone(),
                    },
                );
            }
        })
}

/// Starts a run for an external caller: the slot first, then the selection,
/// then the overlay, which asks for access or text when it needs to.
pub(super) fn start(
    app: &AppHandle,
    request: RunRequest,
    source: ActivationSource,
) -> ApiResult<Job> {
    // a command whose tool needs the catalog fails the lookup with
    // `NotReady` while it is loading; a script or a webhook does not wait
    let command = lookup(app, &request.target, request.by_name)?;
    validate_run(&command, &request)?;
    let state = app.state::<AppState>();
    if state.is_quitting() {
        return Err(Box::new(Response::coded_error(
            ErrorCode::Unavailable,
            "TyCo is quitting",
        )));
    }
    let config = state.user_config();
    let jobs = app.state::<ExternalJobs>();
    if request.quiet {
        ensure_quiet_run(app, &config, &command.id)?;
        if !jobs.is_quiet_executor_ready() {
            return Err(Box::new(Response::coded_error(
                ErrorCode::NotReady,
                "The background command executor is loading",
            )));
        }
    }
    let name = command_name(&config, &command.id);
    let job = reserve(
        app,
        NewJob {
            command_id: command.id.clone(),
            command_name: name.clone(),
            request: request.clone(),
            is_internal: false,
            command_snapshot: raw_command(&config, &command.id).cloned(),
        },
    )
    .map_err(|error| {
        let code = match error {
            CreateJobError::Busy { .. } => ErrorCode::Busy,
            CreateJobError::Full => ErrorCode::JobLimitReached,
        };
        Box::new(Response::coded_error(code, error.message()))
    })?;
    if request.quiet {
        quiet_status(app, &job, name, None);
        return Ok(job);
    }
    visible_work::end(app);
    if request.selection {
        // taken before the overlay, which moves the focus away from it
        match selection_replace::prepare_external(app) {
            Ok((run_id, text)) => jobs.attach_selection(&job.id, run_id, text),
            Err(error) => {
                let message = error.to_string();
                fail(app, &job.id, message.clone(), ErrorCode::SelectionFailed);
                return Err(Box::new(Response::coded_error(
                    ErrorCode::SelectionFailed,
                    message,
                )));
            }
        }
    }
    // without the permission the user is asked in the overlay
    let should_ask_access = request.selection && !is_selection_access_allowed(&config);
    if should_ask_access {
        access::begin(app, &job.id);
    }
    show(
        app,
        CommandRunRequest {
            job_id: job.id.clone(),
            command_id: command.id,
            command_name: name,
            should_ask_access,
            should_replace: request.replace,
            is_external: true,
        },
        source,
        None,
    )?;
    Ok(job)
}

/// Starts a run of a hotkey or the action menu in the quick window: the same
/// slot as external runs, without their grant.
pub fn start_internal(
    app: &AppHandle,
    command_id: &str,
    text: Option<String>,
) -> Result<Job, AppError> {
    let config = app.state::<AppState>().user_config();
    if crate::models::user_config::command(&config, command_id).is_none() {
        return Err(AppError::NotFound(format!("No such command: {command_id}")));
    }
    let name = command_name(&config, command_id);
    let job = reserve(
        app,
        NewJob {
            command_id: command_id.to_owned(),
            command_name: name.clone(),
            request: RunRequest {
                target: command_id.to_owned(),
                text,
                ..Default::default()
            },
            is_internal: true,
            command_snapshot: raw_command(&config, command_id).cloned(),
        },
    )
    .map_err(|error| AppError::Busy(error.message()))?;
    // the output goes where the menu or the hotkey was opened from
    let target = app
        .state::<AppState>()
        .snapshot()
        .activation
        .target_window_id;
    show(
        app,
        CommandRunRequest {
            job_id: job.id.clone(),
            command_id: command_id.to_owned(),
            command_name: name,
            should_ask_access: false,
            should_replace: false,
            is_external: false,
        },
        ActivationSource::Ui,
        target,
    )
    .map_err(|error| AppError::ServiceUnavailable(error.error.unwrap_or_default()))?;
    Ok(job)
}

/// Opens the command overlay on the run; a run that cannot be shown fails.
fn show(
    app: &AppHandle,
    run: CommandRunRequest,
    source: ActivationSource,
    target_window_id: Option<String>,
) -> ApiResult<()> {
    let job_id = run.job_id.clone();
    let mut activation = Activation::new(ActivationMode::CommandRun, source);
    // the selection is taken already; the overlay must not capture another
    activation.selected_text = Some(String::new());
    activation.target_window_id = target_window_id;
    activation.command_run = Some(run);
    runtime::activate(app, activation).map_err(|error| {
        access::withdraw(app, &job_id);
        let message = error.to_string();
        fail(app, &job_id, message.clone(), ErrorCode::Unavailable);
        Box::new(Response::coded_error(ErrorCode::Unavailable, message))
    })
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

fn fail_with(app: &AppHandle, id: &str, error: Response) {
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

/// A webview reload invalidates only the job owned by that webview.
pub fn abandon_active(app: &AppHandle, quiet: bool) {
    let jobs = app.state::<ExternalJobs>();
    if quiet {
        jobs.set_quiet_executor_ready(false);
    }
    if let Some(id) = jobs.active_id_for(quiet) {
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            access::withdraw(&handle, &id);
            fail(
                &handle,
                &id,
                "The command executor was reloaded".into(),
                ErrorCode::Unavailable,
            );
        });
    }
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
    let Some((job, selection_run_id, history)) =
        jobs.finish_with_history(id, state, completion.output, completion.message, code)
    else {
        return;
    };
    if completion.is_cancelled {
        let _ = events::emit_to::<events::ExternalJobCancel, _>(
            app,
            if jobs.is_quiet(id) {
                runtime::QUIET_WINDOW_LABEL
            } else {
                runtime::QUICK_WINDOW_LABEL
            },
            id.to_owned(),
        );
    }
    if let Some(run_id) = selection_run_id {
        // The original target is retained even while the command launcher is open.
        let replace = job.state == JobState::Succeeded && jobs_request_replace(app, id);
        let output = job.output.clone().filter(|text| !text.trim().is_empty());
        if replace {
            // the overlay goes and the target window takes the keys back
            hide_overlay(app);
            runtime::wait_until_unfocused(app, runtime::FOCUS_RELEASE_TIMEOUT);
        }
        let result =
            selection_replace::finish(app, run_id, if replace { output.clone() } else { None });
        let error = match result {
            Err(error) => Some(error.to_string()),
            Ok(selection_replace::SelectionFinishStatus::CopiedToClipboard) if replace => {
                Some("Focus changed; result is in the clipboard".into())
            }
            Ok(selection_replace::SelectionFinishStatus::SelectionChanged) if replace => {
                Some("The selection changed; result is in the clipboard".into())
            }
            Ok(selection_replace::SelectionFinishStatus::TerminalClipboard) if replace => {
                Some("A terminal selection cannot be replaced; result is in the clipboard".into())
            }
            Ok(selection_replace::SelectionFinishStatus::Stale) if replace => {
                Some("Selection target is no longer available".into())
            }
            _ if replace && output.is_none() => {
                Some("Command returned no text to replace the selection".into())
            }
            _ => None,
        };
        finish_replacement(app, id, error);
    } else if let Some(history) = history {
        let quiet_name = history.quiet.then(|| history.command_name.clone());
        let history_id = record_history(app, &job, history);
        if let Some(name) = quiet_name {
            quiet_status(app, &job, name, history_id);
        }
    }
}

/// Hides the quick window while it still shows the command overlay, not a
/// mode the user has switched to since.
fn hide_overlay(app: &AppHandle) {
    let snapshot = app.state::<AppState>().snapshot();
    if snapshot.window.is_window_shown
        && snapshot.activation.mode == Some(ActivationMode::CommandRun)
    {
        if let Err(error) = runtime::hide_active_window(app) {
            log::warn!("Could not hide the command overlay: {error}");
        }
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
    if !job.state.is_terminal() && !jobs.is_replacing_selection(id) {
        access::withdraw(app, id);
        let message = match code {
            ErrorCode::TimedOut if job.state == JobState::Accepted => {
                "The command was not started in time"
            }
            ErrorCode::TimedOut => "The command did not finish within its time limit",
            _ => "The command was cancelled",
        };
        complete(
            app,
            id,
            JobCompletion {
                is_success: false,
                is_cancelled: true,
                output: None,
                message: Some(message.into()),
                code: Some(code.into()),
            },
        );
    }
    Response::json(&jobs.get(id))
}

/// Starts the job in the overlay and hands over what it runs; `None` when
/// the job is gone, taken or over, or may not run any more.
pub fn claim(app: &AppHandle, id: &str) -> Option<CommandRunPayload> {
    let jobs = app.state::<ExternalJobs>();
    let config = app.state::<AppState>().user_config();
    let run_limit = crate::models::user_config::command_run_limit(&config);
    let (command_id, request) = jobs.claim(id, run_limit)?;
    if !jobs.is_internal(id) {
        if let Err(error) = lookup(app, &command_id, false) {
            fail_with(app, id, *error);
            return None;
        }
        if request.selection && !jobs.is_selection_approved(id) {
            if let Err(error) = ensure_selection_access_allowed(&config) {
                fail_with(app, id, *error);
                return None;
            }
        }
    }
    if !jobs.is_command_unchanged(id, raw_command(&config, &command_id)) {
        fail(
            app,
            id,
            "Command configuration changed before execution".into(),
            ErrorCode::ConfigurationChanged,
        );
        return None;
    }
    if request.quiet {
        if let Err(error) = ensure_quiet_run(app, &config, &command_id) {
            fail_with(app, id, *error);
            return None;
        }
        if let Some(event) = jobs
            .active_quiet_status()
            .filter(|event| event.job_id == id)
        {
            publish_quiet_status(app, event);
        }
    }
    Some(CommandRunPayload {
        command_id,
        selection_text: request.selection.then(|| request.text.clone()).flatten(),
        text: request.text,
        input: request.input,
        user_config: config,
    })
}

fn ensure_quiet_run(app: &AppHandle, config: &Value, id: &str) -> ApiResult<()> {
    let catalog = app.state::<command_library::OperationCatalogState>().get();
    validate_quiet_run(config, id, catalog.as_ref())?;
    if !raw_command(config, id).is_some_and(command_library::is_quiet_run_allowed) {
        return Err(Box::new(Response::coded_error(
            ErrorCode::AccessDenied,
            "Quiet external runs are not enabled for this command",
        )));
    }
    Ok(())
}

fn validate_quiet_run(
    config: &Value,
    id: &str,
    catalog: Option<&command_library::OperationCatalog>,
) -> ApiResult<()> {
    let Some(catalog) = catalog else {
        return Err(Box::new(Response::coded_error(
            ErrorCode::NotReady,
            "The command executor is still loading",
        )));
    };
    if let Some(code) = command_library::quiet_run_error(config, id, Some(catalog)) {
        let message = if code == ErrorCode::ConfirmationRequired {
            "A tool in this command requires confirmation"
        } else {
            "An operation or tool in this command does not support quiet runs"
        };
        return Err(Box::new(Response::coded_error(code, message)));
    }
    Ok(())
}

fn command_history_entry(
    job: &Job,
    history: RunHistory,
) -> (
    EditorHistoryEntry,
    String,
    Result<Option<String>, EditorHistoryFailure>,
) {
    let result = if job.state == JobState::Succeeded {
        Ok(job.output.clone())
    } else {
        Err(EditorHistoryFailure {
            kind: if job.code.as_deref() == Some(ErrorCode::TimedOut.as_str()) {
                EditorHistoryFailureKind::Timeout
            } else if job.state == JobState::Cancelled {
                EditorHistoryFailureKind::Cancelled
            } else {
                EditorHistoryFailureKind::Error
            },
            message: job.error.clone(),
        })
    };
    let entry = EditorHistoryEntry {
        id: None,
        text: history.input.unwrap_or_default(),
        kind: EditorHistoryKind::Source,
        operation: None,
        origin: Some(if history.is_internal {
            EditorHistoryOrigin::CommandRun
        } else if history.quiet {
            EditorHistoryOrigin::QuietRun
        } else {
            EditorHistoryOrigin::ExternalRun
        }),
        instruction: None,
        profile_id: None,
    };
    (entry, history.command_name, result)
}

fn record_history(app: &AppHandle, job: &Job, history: RunHistory) -> Option<String> {
    let (entry, command_name, result) = command_history_entry(job, history);
    crate::services::storage::add_command_run_history(app, entry, command_name, result)
        .unwrap_or_else(|error| {
            log::warn!("Could not save command run history: {error}");
            None
        })
}

fn quiet_status(app: &AppHandle, job: &Job, command_name: String, history_id: Option<String>) {
    let event = events::QuietRunEvent {
        job_id: job.id.clone(),
        command_name,
        history_id,
        error: job.error.clone(),
        code: job.code.clone(),
        started_at: app.state::<ExternalJobs>().started_at(&job.id),
        state: if job.code.as_deref() == Some(ErrorCode::TimedOut.as_str()) {
            JobState::Failed
        } else {
            job.state.clone()
        },
    };
    publish_quiet_status(app, event);
}

fn publish_quiet_status(app: &AppHandle, event: events::QuietRunEvent) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let active = handle.state::<ExternalJobs>().active_quiet_status();
        let is_running = !event.state.is_terminal();
        if is_running
            && !active
                .as_ref()
                .is_some_and(|active| active.job_id == event.job_id && active.state == event.state)
        {
            return;
        }
        for label in [runtime::QUIET_WINDOW_LABEL, runtime::MAIN_WINDOW_LABEL] {
            let _ = events::emit_to::<events::QuietRunChanged, _>(&handle, label, event.clone());
        }
        if handle.state::<AppState>().is_quitting() {
            return;
        }
        let text = runtime::quiet_run_label(&handle, &event.state, &event.command_name);
        if is_running || active.is_none() {
            if let Err(error) =
                runtime::set_tray_quiet_run(&handle, is_running.then(|| text.clone()))
            {
                log::warn!("Could not update quiet run tray status: {error}");
            }
        }
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        if event.state != JobState::Accepted && (is_running || active.is_none()) {
            let focused = [runtime::MAIN_WINDOW_LABEL, runtime::QUICK_WINDOW_LABEL]
                .iter()
                .any(|label| {
                    handle
                        .get_webview_window(label)
                        .is_some_and(|window| window.is_focused().unwrap_or(false))
                });
            let notice = (!focused).then(|| {
                let reason = event
                    .error
                    .as_deref()
                    .and_then(|error| error.lines().next())
                    .filter(|error| !error.is_empty())
                    .or(event.code.as_deref());
                if let (JobState::Failed, Some(reason)) = (&event.state, reason) {
                    let excerpt: String = reason.chars().take(160).collect();
                    format!("{text} — {excerpt}")
                } else {
                    text
                }
            });
            #[cfg(target_os = "linux")]
            crate::services::platform::notifications::notify_quiet_run(
                &handle,
                event.job_id,
                notice,
                !is_running,
            );
            #[cfg(target_os = "windows")]
            if let Some(notice) = notice {
                if let Err(error) = crate::services::platform::notifications::notify_quiet_run(
                    &handle,
                    handle.package_info().name.as_str(),
                    &notice,
                ) {
                    log::warn!("Could not show quiet run notification: {error}");
                }
            }
        }
    });
}

fn finish_replacement(app: &AppHandle, id: &str, error: Option<String>) {
    if let Some((job, history)) = app
        .state::<ExternalJobs>()
        .complete_selection_replacement(id, error)
    {
        record_history(app, &job, history);
    }
}

pub fn cancel_quiet_on_shutdown(app: &AppHandle) {
    if let Some(id) = app
        .try_state::<ExternalJobs>()
        .and_then(|jobs| jobs.active_id_for(true))
    {
        cancel(app, &id, ErrorCode::Cancelled);
    }
}

/// Cancels jobs that waited too long to start and runs over their limit,
/// even when no external client polls them.
pub fn spawn_reaper(app: AppHandle) -> Result<(), AppError> {
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    services.spawn_async(async move {
        let app = handle;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            for id in app.state::<ExternalJobs>().stale_replacement_ids() {
                let handle = app.clone();
                let _ = app
                    .state::<crate::services::background::BackgroundServices>()
                    .run_blocking(move || {
                        finish_replacement(
                            &handle,
                            &id,
                            Some("The selection replacement did not finish in time".into()),
                        )
                    })
                    .await;
            }
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
    use super::*;

    #[test]
    fn quiet_claim_rechecks_current_operation_metadata() {
        let config =
            serde_json::json!({"commands": [{"id": "fixture", "operationId": "Plugin.task"}]});
        let operation = serde_json::from_value(serde_json::json!({
            "id": "Plugin.task", "input": "none", "available": true, "canRunQuietly": true,
        }))
        .unwrap();
        let mut catalog = command_library::catalog_from(vec![operation]);
        assert!(validate_quiet_run(&config, "fixture", Some(&catalog)).is_ok());
        catalog.get_mut("Plugin.task").unwrap().can_run_quietly = false;
        assert_eq!(
            validate_quiet_run(&config, "fixture", Some(&catalog))
                .unwrap_err()
                .error_code(),
            ErrorCode::QuietRunUnsupported,
        );
    }

    #[test]
    fn quiet_timeout_preserves_input_and_history_origin() {
        let jobs = ExternalJobs::default();
        let job = jobs
            .create(NewJob {
                command_id: "fixture".into(),
                command_name: "Fixture".into(),
                request: RunRequest {
                    quiet: true,
                    text: Some("original".into()),
                    ..Default::default()
                },
                is_internal: false,
                command_snapshot: None,
            })
            .unwrap();
        let (job, _, history) = jobs
            .finish_with_history(
                &job.id,
                JobState::Cancelled,
                None,
                Some("Run timed out".into()),
                Some(ErrorCode::TimedOut.into()),
            )
            .unwrap();
        let (entry, name, outcome) = command_history_entry(&job, history.unwrap());
        assert_eq!(entry.origin, Some(EditorHistoryOrigin::QuietRun));
        assert_eq!(entry.text, "original");
        assert_eq!(name, "Fixture");
        assert_eq!(outcome.unwrap_err().kind, EditorHistoryFailureKind::Timeout);
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
        assert_eq!(keep_selection_whitespace("  \n", "text"), "  \ntext");
    }
}
