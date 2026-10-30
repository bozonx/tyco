mod command_logging;
mod file_dialogs;
mod process_runner;

pub use command_logging::{action_log_path, log_command_run, log_custom_action, CommandRunRecord};
pub use file_dialogs::{pick_directory, pick_script_file};
pub use process_runner::{
    execute_script, ScriptExecutionResult, ScriptRequest, ScriptRuns, TEXT_PLACEHOLDER,
};

use std::{path::Path, time::Duration};

use serde_json::Value;

use crate::{errors::AppError, models::user_config};

/// A run of a script saved in the library; the shell command, working
/// directory and timeout come from the config, never from the caller.
pub struct SavedScriptRun<'a> {
    pub command_id: &'a str,
    pub text: &'a str,
    pub should_capture_output: bool,
    pub should_log_output: bool,
    pub run_id: Option<&'a str>,
}

/// Runs the saved script `run.command_id` of `config`.
pub fn execute_saved_script(
    runs: &ScriptRuns,
    config: &Value,
    run: &SavedScriptRun,
    log_dir: Option<&Path>,
) -> Result<ScriptExecutionResult, AppError> {
    let command = user_config::script_command(config, run.command_id).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "No saved script command with the id `{}`",
            run.command_id
        ))
    })?;
    let tool_config = &command.tool_config;
    execute_script(
        runs,
        &ScriptRequest {
            name: &command.label,
            command: &tool_config.command,
            working_dir: Some(tool_config.working_directory.as_str())
                .filter(|dir| !dir.trim().is_empty()),
            text: run.text,
            should_capture_output: run.should_capture_output,
            output_timeout: tool_config.timeout_sec.map(Duration::from_secs),
            should_log_output: run.should_log_output,
            run_id: run.run_id,
        },
        log_dir,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_or_non_script_command_is_refused_before_running() {
        let config = serde_json::json!({"commands": [
            {"id": "hook", "name": "Hook", "toolId": "webhook", "toolConfig": {"url": "x"}},
        ]});
        for command_id in ["missing", "hook"] {
            let result = execute_saved_script(
                &ScriptRuns::default(),
                &config,
                &SavedScriptRun {
                    command_id,
                    text: "",
                    should_capture_output: true,
                    should_log_output: false,
                    run_id: None,
                },
                None,
            );
            assert!(matches!(result, Err(AppError::InvalidInput(_))));
        }
    }
}
