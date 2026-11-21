//! Asks the user in the command overlay whether an external call may use the
//! selection while `externalAccess.canAccessSelection` is off: once, from now
//! on, or not at all.
use crate::locks::MutexExt;
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::services::external::api;
use crate::services::external::jobs::ExternalJobs;
use crate::services::settings;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum AccessDecision {
    Once,
    Always,
    Deny,
}

/// The job waiting for an answer; one run at a time, so at most one.
#[derive(Default)]
pub struct AccessPrompt(Mutex<Option<String>>);

impl AccessPrompt {
    fn set(&self, job_id: &str) {
        *self.0.locked() = Some(job_id.to_owned());
    }

    fn take(&self, job_id: &str) -> bool {
        let mut pending = self.0.locked();
        if pending.as_deref() == Some(job_id) {
            pending.take();
            true
        } else {
            false
        }
    }
}

/// The overlay of the job asks for access before it runs.
pub fn begin(app: &AppHandle, job_id: &str) {
    app.state::<AccessPrompt>().set(job_id);
}

/// Applies the answer of the overlay; a job answered, cancelled or timed out
/// before is left alone. The overlay runs an allowed job itself.
pub fn answer(app: &AppHandle, job_id: &str, decision: AccessDecision) -> Result<(), AppError> {
    if !app.state::<AccessPrompt>().take(job_id) {
        return Ok(());
    }
    match decision {
        AccessDecision::Deny => {
            api::deny_selection(app, job_id);
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
    Ok(())
}

/// The job is over before the user answered.
pub fn withdraw(app: &AppHandle, job_id: &str) {
    app.state::<AccessPrompt>().take(job_id);
}

fn allow_selection_from_now_on(app: &AppHandle) -> Result<(), AppError> {
    settings::update_user_config(app, grant_selection).map(drop)
}

fn grant_selection(user_config: &mut Value) {
    let Some(config) = user_config.as_object_mut() else {
        return;
    };
    let access = config.entry("externalAccess").or_insert_with(|| json!({}));
    if !access.is_object() {
        *access = json!({});
    }
    access["canAccessSelection"] = json!(true);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn granting_keeps_the_other_settings() {
        let mut config =
            json!({"externalAccess":{"canAccessSelection":false } ,"appearance":{"theme":"dark"}});
        grant_selection(&mut config);
        assert_eq!(
            config["externalAccess"],
            json!({ "canAccessSelection": true })
        );
        assert_eq!(config["appearance"]["theme"], json!("dark"));

        let mut config = json!({ "externalAccess": null });
        grant_selection(&mut config);
        assert_eq!(
            config["externalAccess"],
            json!({ "canAccessSelection": true })
        );

        let mut config = json!({});
        grant_selection(&mut config);
        assert_eq!(
            config["externalAccess"],
            json!({ "canAccessSelection": true })
        );
    }

    #[test]
    fn only_the_waiting_job_takes_the_prompt() {
        let prompt = AccessPrompt::default();
        prompt.set("job-1");
        assert!(!prompt.take("job-2"));
        assert!(prompt.take("job-1"));
        assert!(!prompt.take("job-1"));
    }

    #[test]
    fn decisions_read_their_ui_spelling() {
        let decision: AccessDecision = serde_json::from_value(json!("always")).unwrap();
        assert_eq!(decision, AccessDecision::Always);
    }
}
