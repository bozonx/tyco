//! Asks the user whether an external call may use the selection while
//! `externalAccess.selection` is off: once, from now on, or not at all.
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::activation::{Activation, ActivationMode, ActivationSource};
use super::external_api;
use super::external_jobs::ExternalJobs;
use super::{config_version, runtime, storage};
use crate::errors::AppError;
use crate::state::AppState;

const FOCUS_RELEASE_TIMEOUT: Duration = Duration::from_millis(300);

/// What the prompt shows, see `DesktopSnapshot::access_request`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessRequest {
    pub job_id: String,
    pub command_name: String,
    /// The output is to replace the selection, not only to be returned.
    pub replace: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccessDecision {
    Once,
    Always,
    Deny,
}

struct PendingAccessRequest {
    job_id: String,
    source: ActivationSource,
}

/// The one request waiting for an answer: a second one is refused rather
/// than queued behind a prompt the user may not have seen yet.
#[derive(Default)]
pub struct AccessPrompt(Mutex<Option<PendingAccessRequest>>);

impl AccessPrompt {
    pub fn is_pending(&self) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_some()
    }

    /// Takes the prompt for `pending`; false while another request waits.
    /// One step, so that two requests at once cannot both take it.
    fn claim(&self, pending: PendingAccessRequest) -> bool {
        let mut slot = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if slot.is_some() {
            return false;
        }
        *slot = Some(pending);
        true
    }

    fn take(&self, job_id: &str) -> Option<PendingAccessRequest> {
        let mut pending = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if pending.as_ref().is_some_and(|item| item.job_id == job_id) {
            pending.take()
        } else {
            None
        }
    }
}

/// Why the prompt was not shown.
#[derive(Debug)]
pub enum AccessPromptError {
    /// Another request is waiting for an answer.
    Busy,
    Failed(AppError),
}

/// Shows the prompt for the job; it runs once the user allows it.
pub fn ask(
    app: &AppHandle,
    request: AccessRequest,
    source: ActivationSource,
) -> Result<(), AccessPromptError> {
    let claimed = app.state::<AccessPrompt>().claim(PendingAccessRequest {
        job_id: request.job_id.clone(),
        source,
    });
    if !claimed {
        return Err(AccessPromptError::Busy);
    }
    let mut activation = Activation::new(ActivationMode::ExternalAccess, source);
    // the selection is taken already; the prompt must not capture another
    activation.selected_text = Some(String::new());
    let job_id = request.job_id.clone();
    activation.access_request = Some(request);
    runtime::activate(app, activation).map_err(|error| {
        app.state::<AccessPrompt>().take(&job_id);
        AccessPromptError::Failed(error)
    })
}

/// Applies the answer of the prompt; a job answered, cancelled or timed out
/// before is left alone.
pub fn answer(app: &AppHandle, job_id: &str, decision: AccessDecision) -> Result<(), AppError> {
    let Some(pending) = app.state::<AccessPrompt>().take(job_id) else {
        return Ok(());
    };
    hide_prompt(app);
    // the command and the replacement need the window of the selection back
    runtime::wait_until_unfocused(app, FOCUS_RELEASE_TIMEOUT);
    match decision {
        AccessDecision::Deny => {
            external_api::deny_selection(app, job_id);
            return Ok(());
        }
        AccessDecision::Always => {
            if let Err(error) = allow_selection_from_now_on(app) {
                // the user did allow this call, so it runs all the same
                log::error!("Could not allow external selection access: {error}");
            }
        }
        AccessDecision::Once => {}
    }
    app.state::<ExternalJobs>().approve_selection(job_id);
    external_api::resume(app, job_id, pending.source);
    Ok(())
}

/// The job is over before the user answered: the prompt goes away.
pub fn withdraw(app: &AppHandle, job_id: &str) {
    if app.state::<AccessPrompt>().take(job_id).is_some() {
        hide_prompt(app);
    }
}

/// Hides the quick window while it still shows the prompt, not a mode the
/// user has switched to since.
fn hide_prompt(app: &AppHandle) {
    let params = app.state::<AppState>().snapshot();
    if params.window.is_window_shown
        && params.activation.mode == Some(ActivationMode::ExternalAccess)
    {
        if let Err(error) = runtime::hide_active_window(app) {
            log::warn!("Could not hide the access prompt: {error}");
        }
    }
}

fn allow_selection_from_now_on(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let _guard = state.lock_config_storage();
    let mut user_config = state.snapshot().settings.user_config;
    if config_version::is_newer_than_supported(&user_config) {
        return Err(storage::newer_config_error());
    }
    grant_selection(&mut user_config);
    storage::save_user_config(app, &user_config)?;
    state.update_state(|params| {
        params.settings.user_config = user_config;
    });
    runtime::emit_state(app, &state)
}

fn grant_selection(user_config: &mut Value) {
    let Some(config) = user_config.as_object_mut() else {
        return;
    };
    let access = config.entry("externalAccess").or_insert_with(|| json!({}));
    if !access.is_object() {
        *access = json!({});
    }
    access["selection"] = json!(true);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn granting_keeps_the_other_settings() {
        let mut config = json!({ "theme": "dark", "externalAccess": { "selection": false } });
        grant_selection(&mut config);
        assert_eq!(config["externalAccess"], json!({ "selection": true }));
        assert_eq!(config["theme"], json!("dark"));

        let mut config = json!({ "externalAccess": null });
        grant_selection(&mut config);
        assert_eq!(config["externalAccess"], json!({ "selection": true }));

        let mut config = json!({});
        grant_selection(&mut config);
        assert_eq!(config["externalAccess"], json!({ "selection": true }));
    }

    #[test]
    fn only_the_waiting_job_takes_the_prompt() {
        let prompt = AccessPrompt::default();
        assert!(!prompt.is_pending());
        assert!(prompt.claim(PendingAccessRequest {
            job_id: "job-1".into(),
            source: ActivationSource::Cli,
        }));
        assert!(prompt.is_pending());
        // a second request does not take the prompt of the first
        assert!(!prompt.claim(PendingAccessRequest {
            job_id: "job-2".into(),
            source: ActivationSource::Cli,
        }));
        assert!(prompt.take("job-2").is_none());
        assert!(prompt.take("job-1").is_some());
        assert!(!prompt.is_pending());
        assert!(prompt.take("job-1").is_none());
    }

    #[test]
    fn decisions_read_their_ui_spelling() {
        let decision: AccessDecision = serde_json::from_value(json!("always")).unwrap();
        assert_eq!(decision, AccessDecision::Always);
    }
}
