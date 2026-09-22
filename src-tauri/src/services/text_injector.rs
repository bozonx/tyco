use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::errors::AppError;

const FOCUS_TIMEOUT: Duration = Duration::from_secs(2);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Session {
    X11,
    Wayland,
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InjectionMethod {
    Xdotool,
    Ydotool,
}

#[derive(Debug, PartialEq, Eq)]
struct CommandSpec {
    binary: String,
    args: Vec<String>,
    wait_for_completion: bool,
}

pub struct SystemTextInjector {
    session: Session,
}

impl SystemTextInjector {
    pub fn detect() -> Self {
        let session = match std::env::var("XDG_SESSION_TYPE")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "x11" => Session::X11,
            "wayland" => Session::Wayland,
            _ if std::env::var_os("WAYLAND_DISPLAY").is_some() => Session::Wayland,
            _ if std::env::var_os("DISPLAY").is_some() => Session::X11,
            _ => Session::Unsupported,
        };
        Self { session }
    }

    pub fn inject_paste(
        &self,
        user_config: &Value,
        source_window_id: Option<&str>,
    ) -> Result<(), AppError> {
        let insertion = user_config.get("windowInsertion");
        let configured_method = insertion
            .and_then(|value| value.get("method"))
            .and_then(Value::as_str)
            .unwrap_or("xdotool");
        let method = select_method(self.session, configured_method)?;
        let command = command_spec(method, insertion, user_config, source_window_id)?;

        if method == InjectionMethod::Ydotool {
            ensure_ydotool_access()?;
        }
        run_spec(&command)
    }
}

fn select_method(session: Session, configured: &str) -> Result<InjectionMethod, AppError> {
    match (session, configured) {
        (Session::Wayland, _) | (_, "ydotool") => Ok(InjectionMethod::Ydotool),
        (Session::X11, _) => Ok(InjectionMethod::Xdotool),
        (Session::Unsupported, _) => Err(AppError::Message(String::from(
            "Text insertion is unavailable outside an X11 or Wayland session",
        ))),
    }
}

fn command_spec(
    method: InjectionMethod,
    insertion: Option<&Value>,
    user_config: &Value,
    source_window_id: Option<&str>,
) -> Result<CommandSpec, AppError> {
    match method {
        InjectionMethod::Ydotool => Ok(CommandSpec {
            binary: configured_binary(insertion, "ydotoolBin", "/usr/bin/ydotool"),
            args: ["key", "29:1", "47:1", "47:0", "29:0"]
                .into_iter()
                .map(String::from)
                .collect(),
            wait_for_completion: false,
        }),
        InjectionMethod::Xdotool => {
            let window_id = source_window_id.ok_or_else(|| {
                AppError::Message(String::from(
                    "Target window is not available for text insertion",
                ))
            })?;
            let binary = insertion
                .and_then(|value| value.get("xdotoolBin"))
                .and_then(Value::as_str)
                .or_else(|| user_config.get("xdotoolBin").and_then(Value::as_str))
                .unwrap_or("/usr/bin/xdotool")
                .to_owned();
            Ok(CommandSpec {
                binary,
                args: [
                    "windowactivate",
                    "--sync",
                    window_id,
                    "key",
                    "--clearmodifiers",
                    "ctrl+v",
                ]
                .into_iter()
                .map(String::from)
                .collect(),
                wait_for_completion: true,
            })
        }
    }
}

fn configured_binary(insertion: Option<&Value>, key: &str, fallback: &str) -> String {
    insertion
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_owned()
}

fn ydotool_socket_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(path) = std::env::var_os("YDOTOOL_SOCKET") {
        paths.push(PathBuf::from(path));
    }
    if let Some(directory) = std::env::var_os("XDG_RUNTIME_DIR") {
        paths.push(PathBuf::from(directory).join(".ydotool_socket"));
    }
    paths.push(PathBuf::from("/tmp/.ydotool_socket"));
    paths
}

fn ensure_ydotool_access() -> Result<(), AppError> {
    if ydotool_socket_paths().iter().any(|path| path.exists()) {
        return Ok(());
    }
    if OpenOptions::new().write(true).open("/dev/uinput").is_ok() {
        return Ok(());
    }
    Err(AppError::Message(String::from(
        "ydotool cannot insert text: start ydotoold with access to /dev/uinput, or grant your user access through the input group or a udev rule",
    )))
}

fn run_spec(spec: &CommandSpec) -> Result<(), AppError> {
    let child = Command::new(&spec.binary).args(&spec.args).spawn()?;
    let status = if spec.wait_for_completion {
        wait_with_timeout(child, FOCUS_TIMEOUT)?
    } else {
        child.wait_with_output()?.status
    };
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Message(format!(
            "Command `{}` failed with status {status}",
            spec.binary
        )))
    }
}

fn wait_with_timeout(mut child: Child, timeout: Duration) -> Result<ExitStatus, AppError> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            child.kill()?;
            let _ = child.wait();
            return Err(AppError::Message(String::from(
                "Timed out waiting for the source window to receive focus",
            )));
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn wayland_always_uses_ydotool() {
        assert_eq!(
            select_method(Session::Wayland, "xdotool").unwrap(),
            InjectionMethod::Ydotool
        );
    }

    #[test]
    fn x11_uses_the_configured_method() {
        assert_eq!(
            select_method(Session::X11, "xdotool").unwrap(),
            InjectionMethod::Xdotool
        );
        assert_eq!(
            select_method(Session::X11, "ydotool").unwrap(),
            InjectionMethod::Ydotool
        );
    }

    #[test]
    fn xdotool_waits_for_focus_before_pasting() {
        let config = json!({
            "xdotoolBin": "/legacy/xdotool",
            "windowInsertion": { "xdotoolBin": "/custom/xdotool" }
        });
        let spec = command_spec(
            InjectionMethod::Xdotool,
            config.get("windowInsertion"),
            &config,
            Some("42"),
        )
        .unwrap();
        assert_eq!(spec.binary, "/custom/xdotool");
        assert_eq!(
            spec.args,
            [
                "windowactivate",
                "--sync",
                "42",
                "key",
                "--clearmodifiers",
                "ctrl+v"
            ]
        );
        assert!(spec.wait_for_completion);
    }

    #[test]
    fn ydotool_presses_and_releases_paste_keys() {
        let config = json!({ "ydotoolBin": "/custom/ydotool" });
        let spec =
            command_spec(InjectionMethod::Ydotool, Some(&config), &Value::Null, None).unwrap();
        assert_eq!(spec.binary, "/custom/ydotool");
        assert_eq!(spec.args, ["key", "29:1", "47:1", "47:0", "29:0"]);
        assert!(!spec.wait_for_completion);
    }

    #[test]
    fn unsupported_sessions_fail_with_a_clear_error() {
        let error = select_method(Session::Unsupported, "xdotool").unwrap_err();
        assert!(error.to_string().contains("X11 or Wayland"));
    }
}
