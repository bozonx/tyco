use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{App, AppHandle, Emitter, Manager};

use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::runtime;
use crate::state::AppState;

pub const START_EVENT: &str = "app://activation-metrics-start";
pub const COLLECT_EVENT: &str = "app://activation-metrics-collect";
const ENABLE_ENV: &str = "TYCO_ACTIVATION_BENCH";
const CSV_ENV: &str = "TYCO_METRICS_CSV";

pub fn now_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before Unix epoch")
        .as_nanos()
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trial {
    pub id: u64,
    pub t0_trigger: u128,
    pub t1_ipc: Option<u128>,
    pub t2_show: Option<u128>,
    pub t3_frame: Option<u128>,
    pub t4_os_focus: Option<u128>,
    pub t4_dom_focus: Option<u128>,
    pub t5_first_char: Option<u128>,
    pub value: String,
}

pub struct ActivationMetrics {
    enabled: bool,
    trials: Mutex<HashMap<u64, Trial>>,
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

    fn start(&self, id: u64, t0_trigger: u128) {
        self.trials.lock().expect("metrics lock poisoned").insert(
            id,
            Trial {
                id,
                t0_trigger,
                t1_ipc: Some(now_ns()),
                ..Trial::default()
            },
        );
    }

    fn mark(&self, id: u64, apply: impl FnOnce(&mut Trial)) {
        if !self.enabled {
            return;
        }
        if let Some(trial) = self
            .trials
            .lock()
            .expect("metrics lock poisoned")
            .get_mut(&id)
        {
            apply(trial);
        }
    }

    fn mark_latest(&self, apply: impl FnOnce(&mut Trial)) {
        if !self.enabled {
            return;
        }
        if let Some(trial) = self
            .trials
            .lock()
            .expect("metrics lock poisoned")
            .values_mut()
            .max_by_key(|trial| trial.t0_trigger)
        {
            apply(trial);
        }
    }

    fn submit_value(&self, id: u64, value: String) {
        self.mark(id, |trial| trial.value = value);
        self.result_ready.notify_all();
    }

    fn wait_for_result(&self, id: u64) -> Option<Trial> {
        let trials = self.trials.lock().expect("metrics lock poisoned");
        let (trials, _) = self
            .result_ready
            .wait_timeout_while(trials, Duration::from_secs(2), |trials| {
                trials.get(&id).is_none_or(|trial| trial.value.is_empty())
            })
            .expect("metrics lock poisoned");
        trials.get(&id).cloned()
    }

    fn write_row(&self, trial: &Trial, chars_sent: usize) {
        let mut csv = self.csv.lock().expect("metrics CSV lock poisoned");
        let Some(writer) = csv.as_mut() else { return };
        let elapsed = |value: Option<u128>| {
            value
                .filter(|value| *value >= trial.t0_trigger)
                .map(|value| format!("{:.1}", (value - trial.t0_trigger) as f64 / 1_000_000.0))
                .unwrap_or_default()
        };
        let landed = trial.value.chars().count();
        let _ = writeln!(
            writer,
            "{},{},{},{},{},{},{},{},{},{}",
            trial.id,
            chars_sent,
            landed,
            chars_sent.saturating_sub(landed),
            landed.saturating_sub(chars_sent),
            elapsed(trial.t2_show),
            elapsed(trial.t3_frame),
            elapsed(trial.t4_os_focus),
            elapsed(trial.t4_dom_focus),
            elapsed(trial.t5_first_char),
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
        metrics.mark_latest(|trial| trial.t2_show = Some(now_ns()));
    }
}

pub fn mark_os_focus(app: &AppHandle) {
    if let Some(metrics) = app.try_state::<ActivationMetrics>() {
        metrics.mark_latest(|trial| trial.t4_os_focus = Some(now_ns()));
    }
}

pub fn mark_from_frontend(app: &AppHandle, id: u64, mark: &str) {
    let Some(metrics) = app.try_state::<ActivationMetrics>() else {
        return;
    };
    metrics.mark(id, |trial| match mark {
        "frame" => {
            trial.t3_frame.get_or_insert_with(now_ns);
        }
        "dom-focus" => {
            trial.t4_dom_focus.get_or_insert_with(now_ns);
        }
        "first-char" => {
            trial.t5_first_char.get_or_insert_with(now_ns);
        }
        _ => {}
    });
}

pub fn submit_value(app: &AppHandle, id: u64, value: String) {
    if let Some(metrics) = app.try_state::<ActivationMetrics>() {
        metrics.submit_value(id, value);
    }
}

#[cfg(unix)]
fn socket_path() -> std::path::PathBuf {
    let directory = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| String::from("/tmp"));
    let suffix = std::env::var("TYCO_METRICS_SOCKET_SUFFIX").unwrap_or_default();
    std::path::PathBuf::from(directory).join(format!("tyco-activation-metrics{suffix}.sock"))
}

#[cfg(unix)]
fn spawn_socket(app: AppHandle) -> Result<(), AppError> {
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixListener;

    let path = socket_path();
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    let listener = UnixListener::bind(&path)?;
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let Ok(mut writer) = stream.try_clone() else {
                continue;
            };
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                let response = handle_request(&app, line.trim());
                if writeln!(writer, "{response}").is_err() {
                    break;
                }
                let _ = writer.flush();
            }
        }
        let _ = std::fs::remove_file(path);
    });
    Ok(())
}

fn handle_request(app: &AppHandle, request: &str) -> String {
    let parts = request.split_whitespace().collect::<Vec<_>>();
    match parts.as_slice() {
        ["ping"] => String::from("pong"),
        ["show", id, t0] => match (id.parse::<u64>(), t0.parse::<u128>()) {
            (Ok(id), Ok(t0)) => {
                let metrics = app.state::<ActivationMetrics>();
                metrics.start(id, t0);
                let state = app.state::<AppState>();
                state.update_params(|params| params.quick_input = true);
                match runtime::activate(
                    app,
                    Activation::new(StartMode::Editor, ActivationSource::Cli),
                ) {
                    Ok(()) => {
                        if let Some(window) = app.get_webview_window(runtime::QUICK_WINDOW_LABEL) {
                            let _ = window.emit(START_EVENT, serde_json::json!({ "id": id }));
                        }
                        String::from("ok")
                    }
                    Err(error) => format!("error: {error}"),
                }
            }
            _ => String::from("error: invalid show request"),
        },
        ["result", id, chars_sent] => match (id.parse::<u64>(), chars_sent.parse::<usize>()) {
            (Ok(id), Ok(chars_sent)) => {
                if let Some(window) = app.get_webview_window(runtime::QUICK_WINDOW_LABEL) {
                    let _ = window.emit(COLLECT_EVENT, serde_json::json!({ "id": id }));
                }
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
        ["hide"] => match runtime::hide_main_window(app, &app.state::<AppState>()) {
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
    fn records_marks_without_overwriting_the_first_timestamp() {
        let metrics = ActivationMetrics {
            enabled: true,
            trials: Mutex::new(HashMap::new()),
            result_ready: Condvar::new(),
            csv: Mutex::new(None),
        };
        metrics.start(7, 10);
        metrics.mark(7, |trial| {
            trial.t3_frame.get_or_insert(20);
        });
        metrics.mark(7, |trial| {
            trial.t3_frame.get_or_insert(30);
        });
        metrics.submit_value(7, String::from("123"));
        assert_eq!(metrics.wait_for_result(7).unwrap().t3_frame, Some(20));
    }
}
