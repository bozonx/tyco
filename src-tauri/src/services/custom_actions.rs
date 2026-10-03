use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::errors::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExecutionResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub fn execute_script(
    name: &str,
    command: &str,
    text: &str,
    log_output: bool,
) -> Result<ScriptExecutionResult, AppError> {
    let start = Instant::now();

    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("powershell.exe");
    #[cfg(target_os = "windows")]
    cmd.args(["-NoProfile", "-Command", command]);

    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("/bin/zsh");
    #[cfg(target_os = "macos")]
    cmd.args(["-c", command]);

    #[cfg(target_os = "linux")]
    let mut cmd = Command::new("/bin/sh");
    #[cfg(target_os = "linux")]
    cmd.args(["-c", command]);

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let mut cmd = Command::new("sh");
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    cmd.args(["-c", command]);

    cmd.env("TYCO_TEXT", text);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|error| {
        log::error!("[Action: \"{name}\"] Failed to spawn command `{command}`: {error}");
        AppError::Message(format!("Failed to spawn command: {error}"))
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }

    let output = child.wait_with_output().map_err(|error| {
        log::error!("[Action: \"{name}\"] Failed to wait for command `{command}`: {error}");
        AppError::Message(format!("Command execution failed: {error}"))
    })?;

    let duration = start.elapsed();
    let exit_code = output.status.code();
    let success = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !success {
        log::warn!(
            "[Action: \"{name}\"] Command `{command}` failed with exit code {exit_code:?} in {duration:?}. stderr: {stderr}"
        );
    } else if log_output {
        log::info!(
            "[Action: \"{name}\"] Command `{command}` succeeded with exit code {exit_code:?} in {duration:?}.\nstdout: {stdout}\nstderr: {stderr}"
        );
    } else {
        log::info!(
            "[Action: \"{name}\"] Command `{command}` finished in {duration:?} with exit code {exit_code:?}"
        );
    }

    Ok(ScriptExecutionResult {
        success,
        exit_code,
        stdout,
        stderr,
    })
}

pub fn pick_script_file() -> Result<Option<String>, AppError> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("zenity")
            .args(["--file-selection", "--title=Select Script File"])
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            }
        }
        if let Ok(output) = Command::new("kdialog")
            .args(["--getopenfilename", "."])
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            }
        }
        Ok(None)
    }

    #[cfg(target_os = "macos")]
    {
        let script = "POSIX path of (choose file with prompt \"Select Script File\")";
        if let Ok(output) = Command::new("osascript").args(["-e", script]).output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            }
        }
        Ok(None)
    }

    #[cfg(target_os = "windows")]
    {
        let script = "[System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms') | Out-Null; $dialog = New-Object System.Windows.Forms.OpenFileDialog; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }";
        if let Ok(output) = Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            }
        }
        Ok(None)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executes_simple_echo_command() {
        let result = execute_script("Test Echo", "echo hello_tyco", "", false).unwrap();
        assert!(result.success);
        assert_eq!(result.exit_code, Some(0));
        assert!(result.stdout.contains("hello_tyco"));
    }

    #[test]
    fn receives_env_var() {
        #[cfg(not(target_os = "windows"))]
        let cmd = "echo \"$TYCO_TEXT\"";
        #[cfg(target_os = "windows")]
        let cmd = "Write-Output $env:TYCO_TEXT";

        let result = execute_script("Test Env", cmd, "secret_content_42", false).unwrap();
        assert!(result.success);
        assert!(result.stdout.contains("secret_content_42"));
    }

    #[test]
    fn handles_command_failure() {
        let result = execute_script("Test Fail", "exit 1", "", false).unwrap();
        assert!(!result.success);
        assert_eq!(result.exit_code, Some(1));
    }
}
