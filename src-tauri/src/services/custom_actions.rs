use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
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

pub fn format_timestamp() -> String {
    let secs = match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_secs(),
        Err(_) => 0,
    };

    let days = secs / 86400;
    let rem = secs % 86400;
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;

    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02} UTC")
}

pub fn expand_home_dir(path: &str) -> PathBuf {
    if path == "~" {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return PathBuf::from(home);
        }
    } else if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(path)
}

pub fn append_action_log(log_dir: &Path, entry: &str) -> std::io::Result<()> {
    fs::create_dir_all(log_dir)?;
    let log_path = log_dir.join("actions.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    file.write_all(entry.as_bytes())?;
    Ok(())
}

pub fn log_custom_action(
    log_dir: &Path,
    name: &str,
    action_type: &str,
    details: &str,
) -> std::io::Result<()> {
    let entry = format!(
        "[{}] [Action: \"{}\"] Type: {}\n{}\n{}\n",
        format_timestamp(),
        name,
        action_type,
        details.trim(),
        "=".repeat(80),
    );
    append_action_log(log_dir, &entry)
}

#[allow(clippy::too_many_arguments)]
pub fn execute_script(
    name: &str,
    execution_type: Option<&str>,
    command: &str,
    args: Option<&str>,
    working_dir: Option<&str>,
    text: &str,
    log_output: bool,
    log_dir: Option<&Path>,
) -> Result<ScriptExecutionResult, AppError> {
    let start = Instant::now();

    let substituted_command = command.replace("{text}", text);
    let substituted_args = args.map(|a| a.replace("{text}", text));

    let is_script_mode = matches!(execution_type, Some("script"));
    let target_command = if is_script_mode {
        let script_target = if substituted_command.contains(' ')
            && !substituted_command.starts_with('"')
            && !substituted_command.starts_with('\'')
        {
            format!("\"{substituted_command}\"")
        } else {
            substituted_command.clone()
        };

        match &substituted_args {
            Some(a) if !a.trim().is_empty() => format!("{script_target} {a}"),
            _ => script_target,
        }
    } else {
        substituted_command.clone()
    };

    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("powershell.exe");
    #[cfg(target_os = "windows")]
    cmd.args(["-NoProfile", "-Command", &target_command]);

    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("/bin/zsh");
    #[cfg(target_os = "macos")]
    cmd.args(["-c", &target_command]);

    #[cfg(target_os = "linux")]
    let mut cmd = Command::new("/bin/sh");
    #[cfg(target_os = "linux")]
    cmd.args(["-c", &target_command]);

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let mut cmd = Command::new("sh");
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    cmd.args(["-c", &target_command]);

    let resolved_cwd = if let Some(wd) = working_dir {
        let trimmed = wd.trim();
        if !trimmed.is_empty() {
            let expanded = expand_home_dir(trimmed);
            if expanded.is_dir() {
                cmd.current_dir(&expanded);
                Some(expanded.to_string_lossy().to_string())
            } else {
                log::warn!("[Action: \"{name}\"] Working directory `{trimmed}` not found, using process cwd");
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    cmd.env("TYCO_TEXT", text);
    cmd.env("TEXT", text);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|error| {
        let msg = format!("Failed to spawn command `{target_command}`: {error}");
        log::error!("[Action: \"{name}\"] {msg}");
        if let Some(dir) = log_dir {
            let entry = format!(
                "[{}] [Action: \"{}\"] (Spawn Error)\nTarget: {}\nError: {}\n{}\n",
                format_timestamp(),
                name,
                target_command,
                error,
                "=".repeat(80),
            );
            let _ = append_action_log(dir, &entry);
        }
        AppError::Message(msg)
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }

    let output = child.wait_with_output().map_err(|error| {
        let msg = format!("Command execution failed: {error}");
        log::error!("[Action: \"{name}\"] {msg}");
        AppError::Message(msg)
    })?;

    let duration = start.elapsed();
    let exit_code = output.status.code();
    let success = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !success {
        log::warn!(
            "[Action: \"{name}\"] Command `{target_command}` failed with exit code {exit_code:?} in {duration:?}. stderr: {stderr}"
        );
    } else if log_output {
        log::info!(
            "[Action: \"{name}\"] Command `{target_command}` succeeded with exit code {exit_code:?} in {duration:?}.\nstdout: {stdout}\nstderr: {stderr}"
        );
    } else {
        log::info!(
            "[Action: \"{name}\"] Command `{target_command}` finished in {duration:?} with exit code {exit_code:?}"
        );
    }

    if log_output || !success {
        if let Some(dir) = log_dir {
            let status_str = if success { "SUCCESS" } else { "FAILED" };
            let cwd_info = resolved_cwd.as_deref().unwrap_or("(default)");
            let entry = format!(
                "[{}] [Action: \"{}\"] Status: {} (exit code: {:?}) Duration: {:?}\nTarget: {}\nCWD: {}\n--- stdout ---\n{}\n--- stderr ---\n{}\n{}\n",
                format_timestamp(),
                name,
                status_str,
                exit_code,
                duration,
                target_command,
                cwd_info,
                if stdout.trim().is_empty() { "(empty)" } else { stdout.trim() },
                if stderr.trim().is_empty() { "(empty)" } else { stderr.trim() },
                "=".repeat(80),
            );
            let _ = append_action_log(dir, &entry);
        }
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

pub fn pick_directory() -> Result<Option<String>, AppError> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("zenity")
            .args([
                "--file-selection",
                "--directory",
                "--title=Select Directory",
            ])
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
            .args(["--getexistingdirectory", "."])
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
        let script = "POSIX path of (choose folder with prompt \"Select Directory\")";
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
        let script = "[System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms') | Out-Null; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }";
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
        let result = execute_script(
            "Test Echo",
            None,
            "echo hello_tyco",
            None,
            None,
            "",
            false,
            None,
        )
        .unwrap();
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

        let result = execute_script(
            "Test Env",
            None,
            cmd,
            None,
            None,
            "secret_content_42",
            false,
            None,
        )
        .unwrap();
        assert!(result.success);
        assert!(result.stdout.contains("secret_content_42"));
    }

    #[test]
    fn substitutes_text_placeholder() {
        #[cfg(not(target_os = "windows"))]
        let cmd = "echo 'result: {text}'";
        #[cfg(target_os = "windows")]
        let cmd = "Write-Output 'result: {text}'";

        let result = execute_script(
            "Test Sub",
            None,
            cmd,
            None,
            None,
            "substituted_val",
            false,
            None,
        )
        .unwrap();
        assert!(result.success);
        assert!(result.stdout.contains("result: substituted_val"));
    }

    #[test]
    fn substitutes_text_in_script_args() {
        #[cfg(not(target_os = "windows"))]
        let (cmd, args) = ("echo", Some("arg_{text}"));
        #[cfg(target_os = "windows")]
        let (cmd, args) = ("Write-Output", Some("arg_{text}"));

        let result = execute_script(
            "Test Script Args",
            Some("script"),
            cmd,
            args,
            None,
            "hello",
            false,
            None,
        )
        .unwrap();
        assert!(result.success);
        assert!(result.stdout.contains("arg_hello"));
    }

    #[test]
    fn respects_working_directory() {
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.to_string_lossy().to_string();

        #[cfg(not(target_os = "windows"))]
        let cmd = "pwd";
        #[cfg(target_os = "windows")]
        let cmd = "(Get-Location).Path";

        let result = execute_script(
            "Test Pwd",
            None,
            cmd,
            None,
            Some(&temp_path),
            "",
            false,
            None,
        )
        .unwrap();
        assert!(result.success);
    }

    #[test]
    fn writes_to_dedicated_actions_log() {
        let temp_dir = std::env::temp_dir().join(format!("tyco_test_log_{}", std::process::id()));
        let result = execute_script(
            "Logged Action",
            None,
            "echo logged_content",
            None,
            None,
            "",
            true,
            Some(&temp_dir),
        )
        .unwrap();
        assert!(result.success);

        let log_file = temp_dir.join("actions.log");
        assert!(log_file.exists());
        let content = fs::read_to_string(&log_file).unwrap();
        assert!(content.contains("[Action: \"Logged Action\"]"));
        assert!(content.contains("logged_content"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn handles_command_failure() {
        let result =
            execute_script("Test Fail", None, "exit 1", None, None, "", false, None).unwrap();
        assert!(!result.success);
        assert_eq!(result.exit_code, Some(1));
    }
}
