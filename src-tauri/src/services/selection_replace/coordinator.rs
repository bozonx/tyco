use crate::locks::MutexExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::{
    is_selection_action, SelectionFinishStatus, SelectionRun, SelectionRunError, SelectionRunEvent,
    TriggerWait,
};
use crate::errors::AppError;

/// A run the webview never finished, e.g. because it was reloaded, must not
/// turn every later hotkey press into a cancellation.
pub(super) const ABANDONED_RUN_AGE: Duration = Duration::from_secs(180);

/// The run a trigger found, see `SelectionRunCoordinator::take_active_at`.
pub(super) enum SelectionRunTakeOutcome {
    Empty,
    Active(SelectionRun),
    Abandoned(SelectionRun),
}

#[derive(Default)]
pub struct SelectionRunCoordinator {
    next_id: AtomicU64,
    pub(super) capturing: Arc<AtomicBool>,
    current: Mutex<Option<SelectionRun>>,
}

impl SelectionRunCoordinator {
    pub(super) fn lock(&self) -> std::sync::MutexGuard<'_, Option<SelectionRun>> {
        self.current.locked()
    }

    /// Takes the run in progress, telling one the webview abandoned.
    pub(super) fn take_active_at(&self, now: Instant) -> SelectionRunTakeOutcome {
        let Some(run) = self.lock().take() else {
            return SelectionRunTakeOutcome::Empty;
        };
        if now.saturating_duration_since(run.started_at) < ABANDONED_RUN_AGE {
            SelectionRunTakeOutcome::Active(run)
        } else {
            log::warn!(
                "Dropping selection run {} the webview never finished",
                run.id
            );
            SelectionRunTakeOutcome::Abandoned(run)
        }
    }

    pub(super) fn take_if(&self, id: u64) -> Option<SelectionRun> {
        let mut current = self.lock();
        if current.as_ref().is_some_and(|run| run.id == id) {
            current.take()
        } else {
            None
        }
    }
}

/// System effects of a selection run. The coordinator never needs a webview
/// or a real clipboard when these operations are substituted.
pub(super) trait SelectionBackend {
    fn can_run(&self) -> bool {
        true
    }
    fn user_config(&self) -> std::sync::Arc<Value>;
    fn wait(&self, wait: TriggerWait);
    fn capture(&self, config: &Value) -> Result<(String, SelectionRun), SelectionRunError>;
    fn restore(&self, run: SelectionRun);
    fn paste(
        &self,
        config: &Value,
        run: SelectionRun,
        text: String,
    ) -> Result<SelectionFinishStatus, AppError>;
    fn publish(&self, event: SelectionRunEvent) -> Result<(), AppError>;
    fn cancelled(&self, id: u64) -> Result<(), AppError>;
}

pub(super) struct CapturingGuard(Arc<AtomicBool>);

impl Drop for CapturingGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// What a trigger does to a run already in progress.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TriggerKind {
    /// A hotkey: pressing it again cancels the run it started.
    Toggle,
    /// A request for this action, e.g. a command picked in the overlay: it
    /// takes the place of a run in progress.
    Replace,
}

pub(super) enum TriggerDecision {
    Busy,
    Cancel(SelectionRun, CapturingGuard),
    /// Cancel this run, then capture anew.
    Replace(SelectionRun, CapturingGuard),
    /// With a run the webview abandoned, whose clipboard goes back first.
    Capture(CapturingGuard, Option<SelectionRun>),
}

impl SelectionRunCoordinator {
    pub(super) fn reserve(&self) -> Option<CapturingGuard> {
        (!self.capturing.swap(true, Ordering::SeqCst))
            .then(|| CapturingGuard(Arc::clone(&self.capturing)))
    }

    pub(super) fn begin_trigger(
        &self,
        action: &str,
        kind: TriggerKind,
        now: Instant,
    ) -> Result<TriggerDecision, AppError> {
        if !is_selection_action(action) {
            return Err(AppError::InvalidInput(format!(
                "Unknown selection action: {action}"
            )));
        }
        // Reserve before inspecting runs: an external capture must not be cancelled.
        let Some(guard) = self.reserve() else {
            return Ok(TriggerDecision::Busy);
        };
        if self.lock().as_ref().is_some_and(|run| run.is_external) {
            return Err(AppError::Busy(
                "An external selection job is running".into(),
            ));
        }
        match self.take_active_at(now) {
            SelectionRunTakeOutcome::Active(run) => Ok(match kind {
                TriggerKind::Toggle => TriggerDecision::Cancel(run, guard),
                TriggerKind::Replace => TriggerDecision::Replace(run, guard),
            }),
            SelectionRunTakeOutcome::Empty => Ok(TriggerDecision::Capture(guard, None)),
            SelectionRunTakeOutcome::Abandoned(run) => {
                Ok(TriggerDecision::Capture(guard, Some(run)))
            }
        }
    }

    pub(super) fn capture_and_publish(
        &self,
        backend: &impl SelectionBackend,
        action: String,
        wait: TriggerWait,
        guard: CapturingGuard,
        abandoned: Option<SelectionRun>,
    ) {
        // the clipboard of the abandoned run would otherwise keep its
        // selection, and the new snapshot would take that for the user's
        if let Some(run) = abandoned {
            backend.restore(run);
        }
        backend.wait(wait);
        let run_id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let user_config = backend.user_config();
        let event = match backend.capture(&user_config) {
            Ok((text, run)) => {
                self.lock().replace(SelectionRun {
                    id: run_id,
                    captured_text: Some(text.clone()),
                    ..run
                });
                SelectionRunEvent {
                    run_id,
                    action,
                    text: Some(text),
                    error: None,
                    user_config,
                }
            }
            Err(error) => {
                log::warn!("Could not capture the selection: {}", error.message);
                SelectionRunEvent {
                    run_id,
                    action,
                    text: None,
                    error: Some(error),
                    user_config,
                }
            }
        };
        drop(guard);
        if let Err(error) = backend.publish(event) {
            log::error!("Could not hand the selection over to the webview: {error}");
            if let Some(run) = self.take_if(run_id) {
                backend.restore(run);
            }
        }
    }

    pub(super) fn prepare_external_with(
        &self,
        backend: &impl SelectionBackend,
        now: Instant,
    ) -> Result<(u64, String), AppError> {
        let _guard = self
            .reserve()
            .ok_or_else(|| AppError::Busy("A selection is being captured".into()))?;
        // a run the webview abandoned must not keep external jobs out for good
        let abandoned = {
            let mut current = self.lock();
            match current.as_ref() {
                None => None,
                Some(run)
                    if !run.is_external
                        && now.saturating_duration_since(run.started_at) >= ABANDONED_RUN_AGE =>
                {
                    log::warn!(
                        "Dropping selection run {} the webview never finished",
                        run.id
                    );
                    current.take()
                }
                Some(_) => return Err(AppError::Busy("A selection run is already active".into())),
            }
        };
        if let Some(run) = abandoned {
            backend.restore(run);
        }
        let (text, mut run) = backend
            .capture(&backend.user_config())
            .map_err(|error| AppError::Failed(error.message))?;
        if !backend.can_run() {
            backend.restore(run);
            return Err(AppError::ServiceUnavailable(
                "Selection service is stopping".into(),
            ));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        run.id = id;
        run.is_external = true;
        run.captured_text = Some(text.clone());
        self.lock().replace(run);
        Ok((id, text))
    }

    pub(super) fn finish_with(
        &self,
        backend: &impl SelectionBackend,
        run_id: u64,
        text: Option<String>,
    ) -> Result<SelectionFinishStatus, AppError> {
        let Some(run) = self.take_if(run_id) else {
            return Ok(SelectionFinishStatus::Stale);
        };
        match text.filter(|_| backend.can_run()) {
            None => {
                backend.restore(run);
                Ok(SelectionFinishStatus::Restored)
            }
            Some(text) => backend.paste(&backend.user_config(), run, text),
        }
    }
}

pub(super) fn cancel_with(backend: &impl SelectionBackend, run: SelectionRun) {
    let id = run.id;
    backend.restore(run);
    if let Err(error) = backend.cancelled(id) {
        log::warn!("Could not report the cancelled selection run: {error}");
    }
}
