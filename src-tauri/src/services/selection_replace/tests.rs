use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::coordinator::{
    cancel_with, SelectionBackend, SelectionRunTakeOutcome, TriggerDecision, ABANDONED_RUN_AGE,
};
use super::*;
use crate::services::platform::selection::is_terminal_class;

#[test]
fn validates_selection_actions() {
    for valid in ["correction", "command:fix"] {
        assert!(is_selection_action(valid), "{valid}");
    }
    for invalid in [
        "",
        // slots of translation languages and AI tasks are not actions
        "translate.0",
        "aiTask.12",
        "other.1",
        "command:",
        "command: ",
    ] {
        assert!(!is_selection_action(invalid), "{invalid}");
    }
}

fn run_at(id: u64, started_at: Instant) -> SelectionRun {
    SelectionRun {
        id,
        is_external: false,
        captured_text: None,
        target: SelectionTarget {
            id: String::from("window"),
            is_terminal: false,
        },
        started_at,
        clipboard_snapshot: None,
    }
}

#[test]
fn recognizes_terminals_by_application_id() {
    for class in [
        "org.kde.konsole",
        "Alacritty",
        "kitty",
        "org.gnome.Ptyxis",
        "xfce4-terminal",
    ] {
        assert!(is_terminal_class(class), "{class}");
    }
    for class in ["firefox", "org.kde.kate", "telegramdesktop", ""] {
        assert!(!is_terminal_class(class), "{class}");
    }
}

#[test]
fn finishes_only_the_current_run() {
    let runs = SelectionRunCoordinator::default();
    runs.lock().replace(run_at(2, Instant::now()));
    assert!(runs.take_if(1).is_none());
    assert_eq!(runs.take_if(2).map(|run| run.id), Some(2));
    assert!(runs.take_if(2).is_none());
}

#[test]
fn an_abandoned_run_is_not_cancelled_but_dropped() {
    let runs = SelectionRunCoordinator::default();
    let now = Instant::now();
    runs.lock().replace(run_at(1, now));
    assert!(matches!(
        runs.take_active_at(now + ABANDONED_RUN_AGE - Duration::from_nanos(1)),
        SelectionRunTakeOutcome::Active(SelectionRun { id: 1, .. })
    ));
    runs.lock().replace(run_at(2, now));
    assert!(matches!(
        runs.take_active_at(now + ABANDONED_RUN_AGE),
        SelectionRunTakeOutcome::Abandoned(SelectionRun { id: 2, .. })
    ));
    assert!(runs.lock().is_none());
}

#[test]
fn an_abandoned_run_gets_its_clipboard_back_before_the_next_capture() {
    let runs = SelectionRunCoordinator::default();
    let backend = Backend::default();
    let guard = runs.reserve().unwrap();
    runs.capture_and_publish(
        &backend,
        "correction".into(),
        TriggerWait::Now,
        guard,
        Some(run_at(9, Instant::now())),
    );
    assert_eq!(
        backend.operations.lock().unwrap()[..3],
        ["restore:9", "wait", "capture"]
    );
}

#[derive(Default)]
struct Backend {
    operations: Mutex<Vec<String>>,
    events: Mutex<Vec<SelectionRunEvent>>,
    capture_error: bool,
    publish_error: bool,
    paste_error: bool,
}

impl SelectionBackend for Backend {
    fn user_config(&self) -> std::sync::Arc<Value> {
        std::sync::Arc::new(serde_json::json!({"setting": true}))
    }
    fn wait(&self, _wait: TriggerWait) {
        self.operations.lock().unwrap().push("wait".into());
    }
    fn capture(&self, config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
        assert_eq!(config, &*self.user_config());
        self.operations.lock().unwrap().push("capture".into());
        if self.capture_error {
            Err(SelectionRunError::new(
                SelectionRunErrorCode::NoSelection,
                "no selection",
            ))
        } else {
            Ok(("selected".into(), run_at(0, Instant::now())))
        }
    }
    fn restore(&self, run: SelectionRun) {
        self.operations
            .lock()
            .unwrap()
            .push(format!("restore:{}", run.id));
    }
    fn paste(
        &self,
        _config: &Value,
        run: SelectionRun,
        text: String,
    ) -> Result<SelectionFinishStatus, AppError> {
        self.operations
            .lock()
            .unwrap()
            .push(format!("paste:{}:{text}", run.id));
        if self.paste_error {
            Err(AppError::Message("paste failed".into()))
        } else {
            Ok(SelectionFinishStatus::Pasted)
        }
    }
    fn publish(&self, event: SelectionRunEvent) -> Result<(), AppError> {
        self.operations.lock().unwrap().push("publish".into());
        self.events.lock().unwrap().push(event);
        if self.publish_error {
            Err(AppError::Message("webview gone".into()))
        } else {
            Ok(())
        }
    }
    fn cancelled(&self, id: u64) -> Result<(), AppError> {
        self.operations.lock().unwrap().push(format!("cancel:{id}"));
        Ok(())
    }
}

fn start(runs: &SelectionRunCoordinator, backend: &Backend) -> u64 {
    let TriggerDecision::Capture(guard, None) =
        runs.begin_trigger("correction", Instant::now()).unwrap()
    else {
        panic!("capture expected");
    };
    runs.capture_and_publish(backend, "correction".into(), TriggerWait::Now, guard, None);
    backend.events.lock().unwrap().last().unwrap().run_id
}

#[test]
fn capture_publish_finish_and_stale_results_have_no_system_dependencies() {
    let runs = SelectionRunCoordinator::default();
    let backend = Backend::default();
    let id = start(&runs, &backend);
    assert_eq!(
        backend.events.lock().unwrap()[0].text.as_deref(),
        Some("selected")
    );
    assert_eq!(
        runs.finish_with(&backend, id + 1, Some("wrong".into()))
            .unwrap(),
        SelectionFinishStatus::Stale
    );
    assert_eq!(
        runs.finish_with(&backend, id, Some("result".into()))
            .unwrap(),
        SelectionFinishStatus::Pasted
    );
    assert_eq!(
        runs.finish_with(&backend, id, None).unwrap(),
        SelectionFinishStatus::Stale
    );
    assert_eq!(
        *backend.operations.lock().unwrap(),
        ["wait", "capture", "publish", "paste:1:result"]
    );
}

#[test]
fn failed_publication_restores_only_its_capture_and_releases_the_reservation() {
    let runs = SelectionRunCoordinator::default();
    let backend = Backend {
        publish_error: true,
        ..Backend::default()
    };
    start(&runs, &backend);
    assert!(runs.lock().is_none());
    assert_eq!(
        *backend.operations.lock().unwrap(),
        ["wait", "capture", "publish", "restore:1"]
    );
    assert!(matches!(
        runs.begin_trigger("correction", Instant::now()).unwrap(),
        TriggerDecision::Capture(..)
    ));
}

#[test]
fn capture_failure_is_published_without_creating_a_run() {
    let runs = SelectionRunCoordinator::default();
    let backend = Backend {
        capture_error: true,
        ..Backend::default()
    };
    start(&runs, &backend);
    assert!(runs.lock().is_none());
    let events = backend.events.lock().unwrap();
    assert_eq!(
        events[0].error.as_ref().unwrap().code,
        SelectionRunErrorCode::NoSelection
    );
    assert!(events[0].text.is_none());
    assert!(!runs.capturing.load(Ordering::SeqCst));
}

#[test]
fn a_second_trigger_cancels_and_keeps_capture_reserved_until_restoration_finishes() {
    let runs = SelectionRunCoordinator::default();
    let backend = Backend::default();
    start(&runs, &backend);
    let TriggerDecision::Cancel(run, guard) =
        runs.begin_trigger("correction", Instant::now()).unwrap()
    else {
        panic!("cancel expected");
    };
    assert!(matches!(
        runs.begin_trigger("correction", Instant::now()).unwrap(),
        TriggerDecision::Busy
    ));
    assert!(runs.prepare_external_with(&backend).is_err());
    cancel_with(&backend, run);
    drop(guard);
    assert_eq!(
        &backend.operations.lock().unwrap()[3..],
        ["restore:1", "cancel:1"]
    );
    assert!(runs.prepare_external_with(&backend).is_ok());
}

#[test]
fn external_capture_is_never_cancelled_and_empty_results_restore_the_clipboard() {
    let runs = SelectionRunCoordinator::default();
    let backend = Backend::default();
    let (id, text) = runs.prepare_external_with(&backend).unwrap();
    assert_eq!(text, "selected");
    assert!(runs.begin_trigger("correction", Instant::now()).is_err());
    assert!(!runs.capturing.load(Ordering::SeqCst));
    assert_eq!(
        runs.finish_with(&backend, id, None).unwrap(),
        SelectionFinishStatus::Restored
    );
    assert!(runs.lock().is_none());
}

#[test]
fn paste_failure_consumes_the_run_and_is_returned_to_the_caller() {
    let runs = SelectionRunCoordinator::default();
    let backend = Backend {
        paste_error: true,
        ..Backend::default()
    };
    let id = start(&runs, &backend);
    assert!(runs
        .finish_with(&backend, id, Some("result".into()))
        .is_err());
    assert!(runs.lock().is_none());
}

#[test]
fn unwinding_releases_capture_and_invalid_actions_do_not_reserve_it() {
    let runs = SelectionRunCoordinator::default();
    assert!(runs.begin_trigger("invalid", Instant::now()).is_err());
    let result = std::panic::catch_unwind(|| {
        let _guard = runs.reserve().unwrap();
        panic!("capture panic");
    });
    assert!(result.is_err());
    assert!(runs.reserve().is_some());
}
