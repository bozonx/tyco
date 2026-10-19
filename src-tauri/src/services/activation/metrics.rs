use crate::locks::MutexExt;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{App, AppHandle, Emitter, Manager};

use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationMode, ActivationSource};
use crate::services::runtime;

pub const START_EVENT: &str = "app://activation-metrics-start";
pub const COLLECT_EVENT: &str = "app://activation-metrics-collect";
const ENABLE_ENV: &str = "TYCO_ACTIVATION_BENCH";
const CSV_ENV: &str = "TYCO_METRICS_CSV";

pub use crate::services::clock::now_ns;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationTrial {
    pub id: u64,
    #[serde(rename = "t0Trigger")]
    pub triggered_at_ns: u128,
    #[serde(rename = "t1Ipc")]
    pub ipc_received_at_ns: Option<u128>,
    #[serde(rename = "t2Show")]
    pub window_shown_at_ns: Option<u128>,
    #[serde(rename = "t3Frame")]
    pub frame_rendered_at_ns: Option<u128>,
    #[serde(rename = "t4OsFocus")]
    pub os_focused_at_ns: Option<u128>,
    #[serde(rename = "t4DomFocus")]
    pub dom_focused_at_ns: Option<u128>,
    #[serde(rename = "t5FirstChar")]
    pub first_char_received_at_ns: Option<u128>,
    #[serde(rename = "value")]
    pub received_text: String,
    #[serde(skip)]
    pub result_submitted: bool,
}

pub struct ActivationMetrics {
    enabled: bool,
    trials: Mutex<HashMap<u64, ActivationTrial>>,
    result_ready: Condvar,
    csv: Mutex<Option<BufWriter<File>>>,
}

impl ActivationMetrics {
    fn from_env() -> Result<Self, AppError> {
        let enabled = std::env::var(ENABLE_ENV).is_ok_and(|value| value == "1");
        let csv = if enabled {
            std::env::var(CSV_ENV)
                .ok()
                .map(|path| -> Result<_, AppError> {
                    let mut writer = BufWriter::new(File::create(path)?);
                    writeln!(
                        writer,
                        "trial,chars_sent,chars_landed,lost,extra,ms_show,ms_frame,ms_os_focus,ms_dom_focus,ms_first_char"
                    )?;
                    writer.flush()?;
                    Ok(writer)
                })
                .transpose()?
        } else {
            None
        };
        Ok(Self {
            enabled,
            trials: Mutex::new(HashMap::new()),
            result_ready: Condvar::new(),
            csv: Mutex::new(csv),
        })
    }

    fn start(&self, id: u64, triggered_at_ns: u128) {
        self.trials.locked().insert(
            id,
            ActivationTrial {
                id,
                triggered_at_ns,
                ipc_received_at_ns: Some(now_ns()),
                ..ActivationTrial::default()
            },
        );
    }

    fn mark(&self, id: u64, apply: impl FnOnce(&mut ActivationTrial)) {
        if !self.enabled {
            return;
        }
        if let Some(trial) = self.trials.locked().get_mut(&id) {
            apply(trial);
        }
    }

    fn mark_latest(&self, apply: impl FnOnce(&mut ActivationTrial)) {
        if !self.enabled {
            return;
        }
        if let Some(trial) = self
            .trials
            .locked()
            .values_mut()
            .max_by_key(|trial| trial.triggered_at_ns)
        {
            apply(trial);
        }
    }

    fn submit_received_text(&self, id: u64, received_text: String) {
        self.mark(id, |trial| {
            trial.received_text = received_text;
            trial.result_submitted = true;
        });
        self.result_ready.notify_all();
    }

    fn wait_for_result(&self, id: u64) -> Option<ActivationTrial> {
        let trials = self.trials.locked();
        let (trials, _) = self
            .result_ready
            .wait_timeout_while(trials, Duration::from_secs(2), |trials| {
                trials.get(&id).is_none_or(|trial| !trial.result_submitted)
            })
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        trials.get(&id).cloned()
    }

    fn write_row(&self, trial: &ActivationTrial, chars_sent: usize) {
        let mut csv = self.csv.locked();
        let Some(writer) = csv.as_mut() else { return };
        let elapsed = |value: Option<u128>| {
            value
                .filter(|value| *value >= trial.triggered_at_ns)
                .map(|value| {
                    format!(
                        "{:.1}",
                        (value - trial.triggered_at_ns) as f64 / 1_000_000.0
                    )
                })
                .unwrap_or_default()
        };
        let landed = trial.received_text.chars().count();
        let _ = writeln!(
            writer,
            "{},{},{},{},{},{},{},{},{},{}",
            trial.id,
            chars_sent,
            landed,
            chars_sent.saturating_sub(landed),
            landed.saturating_sub(chars_sent),
            elapsed(trial.window_shown_at_ns),
            elapsed(trial.frame_rendered_at_ns),
            elapsed(trial.os_focused_at_ns),
            elapsed(trial.dom_focused_at_ns),
            elapsed(trial.first_char_received_at_ns),
        );
        let _ = writer.flush();
    }
}

pub fn setup(app: &mut App) -> Result<(), AppError> {
    let metrics = ActivationMetrics::from_env()?;
    let enabled = metrics.enabled;
    app.manage(metrics);
    if enabled {
        #[cfg(unix)]
        spawn_socket(app.handle().clone())?;
        log::info!("Activation benchmark instrumentation is enabled");
    }
    Ok(())
}

pub fn mark_show(app: &AppHandle) {
    if let Some(metrics) = app.try_state::<ActivationMetrics>() {
        metrics.mark_latest(|trial| trial.window_shown_at_ns = Some(now_ns()));
    }
}

pub fn mark_os_focus(app: &AppHandle) {
    if let Some(metrics) = app.try_state::<ActivationMetrics>() {
        metrics.mark_latest(|trial| trial.os_focused_at_ns = Some(now_ns()));
    }
}

pub fn mark_from_frontend(app: &AppHandle, id: u64, mark: &str) {
    let Some(metrics) = app.try_state::<ActivationMetrics>() else {
        return;
    };
    metrics.mark(id, |trial| match mark {
        "frame" => {
            trial.frame_rendered_at_ns.get_or_insert_with(now_ns);
        }
        "dom-focus" => {
            trial.dom_focused_at_ns.get_or_insert_with(now_ns);
        }
        "first-char" => {
            trial.first_char_received_at_ns.get_or_insert_with(now_ns);
        }
        _ => {}
    });
}

pub fn submit_received_text(app: &AppHandle, id: u64, received_text: String) {
    if let Some(metrics) = app.try_state::<ActivationMetrics>() {
        metrics.submit_received_text(id, received_text);
    }
}

/// In `XDG_RUNTIME_DIR` only: the socket starts activations and returns
/// what was typed, so it must not sit where other users can reach it.
#[cfg(unix)]
fn socket_path() -> Result<std::path::PathBuf, AppError> {
    let directory = crate::services::platform::user_runtime_dir().ok_or_else(|| {
        AppError::ServiceUnavailable(String::from(
            "The activation benchmark socket needs XDG_RUNTIME_DIR",
        ))
    })?;
    let suffix = std::env::var("TYCO_METRICS_SOCKET_SUFFIX").unwrap_or_default();
    Ok(directory.join(format!("tyco-activation-metrics{suffix}.sock")))
}

#[cfg(unix)]
fn spawn_socket(app: AppHandle) -> Result<(), AppError> {
    use std::io::{BufRead, BufReader, Read};
    use std::os::unix::net::UnixListener;

    use std::os::unix::fs::PermissionsExt;

    let path = socket_path()?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    let listener = UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    listener.set_nonblocking(true)?;
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    services.spawn_thread("activation-metrics", move |stop| {
        let app = handle;
        while !stop.is_stopped() {
            let stream = match listener.accept() {
                Ok((stream, _)) => stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if stop.wait(Duration::from_millis(20)) {
                        break;
                    }
                    continue;
                }
                Err(error) => {
                    log::warn!("Metrics socket accept failed: {error}");
                    break;
                }
            };
            let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(100)));
            let Ok(mut writer) = stream.try_clone() else {
                continue;
            };
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            while !stop.is_stopped() {
                let remaining_bytes = 4097usize.saturating_sub(line.len());
                match (&mut reader)
                    .take(remaining_bytes as u64)
                    .read_line(&mut line)
                {
                    Ok(0) => break,
                    Ok(_) => {
                        if line.len() > 4096 {
                            break;
                        }
                        let response = handle_request(&app, line.trim());
                        if writeln!(writer, "{response}")
                            .and_then(|()| writer.flush())
                            .is_err()
                        {
                            break;
                        }
                        line.clear();
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                    {
                        if line.len() > 4096 {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
        let _ = std::fs::remove_file(path);
    })
}

fn handle_request(app: &AppHandle, request: &str) -> String {
    let parts = request.split_whitespace().collect::<Vec<_>>();
    match parts.as_slice() {
        ["ping"] => String::from("pong"),
        ["show", id, t0] => match (id.parse::<u64>(), t0.parse::<u128>()) {
            (Ok(id), Ok(t0)) => {
                let metrics = app.state::<ActivationMetrics>();
                metrics.start(id, t0);
                match runtime::activate(
                    app,
                    Activation::new(ActivationMode::Write, ActivationSource::Cli),
                ) {
                    Ok(()) => {
                        // `emit` would reach the main window too, and it would
                        // answer with its own editor
                        let _ = app.emit_to(
                            runtime::QUICK_WINDOW_LABEL,
                            START_EVENT,
                            serde_json::json!({ "id": id }),
                        );
                        String::from("ok")
                    }
                    Err(error) => format!("error: {error}"),
                }
            }
            _ => String::from("error: invalid show request"),
        },
        ["result", id, chars_sent] => match (id.parse::<u64>(), chars_sent.parse::<usize>()) {
            (Ok(id), Ok(chars_sent)) => {
                let _ = app.emit_to(
                    runtime::QUICK_WINDOW_LABEL,
                    COLLECT_EVENT,
                    serde_json::json!({ "id": id }),
                );
                let metrics = app.state::<ActivationMetrics>();
                match metrics.wait_for_result(id) {
                    Some(trial) => {
                        metrics.write_row(&trial, chars_sent);
                        serde_json::to_string(&trial)
                            .unwrap_or_else(|error| format!("error: {error}"))
                    }
                    None => String::from("error: unknown trial"),
                }
            }
            _ => String::from("error: invalid result request"),
        },
        ["hide"] => match runtime::hide_active_window(app) {
            Ok(()) => String::from("ok"),
            Err(error) => format!("error: {error}"),
        },
        _ => String::from("error: unknown command"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renamed_trial_fields_preserve_the_benchmark_wire_contract() {
        let trial = ActivationTrial {
            id: 7,
            triggered_at_ns: 10,
            ipc_received_at_ns: Some(11),
            window_shown_at_ns: Some(12),
            frame_rendered_at_ns: Some(13),
            os_focused_at_ns: Some(14),
            dom_focused_at_ns: Some(15),
            first_char_received_at_ns: Some(16),
            received_text: String::from("probe"),
            result_submitted: true,
        };
        assert_eq!(
            serde_json::to_value(trial).unwrap(),
            serde_json::json!({
                "id": 7,
                "t0Trigger": 10,
                "t1Ipc": 11,
                "t2Show": 12,
                "t3Frame": 13,
                "t4OsFocus": 14,
                "t4DomFocus": 15,
                "t5FirstChar": 16,
                "value": "probe"
            })
        );
    }

    #[test]
    fn records_marks_without_overwriting_the_first_timestamp() {
        let metrics = ActivationMetrics {
            enabled: true,
            trials: Mutex::new(HashMap::new()),
            result_ready: Condvar::new(),
            csv: Mutex::new(None),
        };
        metrics.start(7, 10);
        metrics.mark(7, |trial| {
            trial.frame_rendered_at_ns.get_or_insert(20);
        });
        metrics.mark(7, |trial| {
            trial.frame_rendered_at_ns.get_or_insert(30);
        });
        metrics.submit_received_text(7, String::from("123"));
        assert_eq!(
            metrics.wait_for_result(7).unwrap().frame_rendered_at_ns,
            Some(20)
        );
    }
}
