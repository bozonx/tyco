use serde::Deserialize;

/// A request of the webview to run a saved script.
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct ScriptActionRequest {
    /// The saved command to run; its shell command, working directory and
    /// timeout are read from the config, see `user_config::script_command`.
    pub command_id: String,
    pub text: String,
    #[serde(rename = "captureOutput")]
    pub should_capture_output: bool,
    #[serde(rename = "logOutput")]
    pub should_log_output: bool,
    /// Lets `cancel_script_action` stop the command.
    pub run_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_request_names_a_saved_command_only() {
        let request: ScriptActionRequest = serde_json::from_value(serde_json::json!({
            "commandId": "notes",
            "text": "",
            "captureOutput": true,
            "logOutput": false
        }))
        .unwrap();
        assert_eq!(request.command_id, "notes");
        assert!(
            serde_json::from_value::<ScriptActionRequest>(serde_json::json!({
                "command": "rm -rf ~",
                "text": "",
                "captureOutput": true,
                "logOutput": false
            }))
            .is_err()
        );
    }
}
