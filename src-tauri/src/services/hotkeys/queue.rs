//! Runs hotkey presses and releases off the thread that reports them, in the
//! order they came. The global shortcut handler runs on the main thread on
//! macOS and Windows, where an activation would block the interface, and the
//! portal reports presses and releases on separate signal streams.
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Instant;

use tauri::{AppHandle, Manager};

use super::{voice_gesture, HotkeyTarget};
use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::background::{BackgroundServices, StoppableService};
use crate::state::AppState;

pub(crate) enum HotkeyEvent {
    Pressed(HotkeyTarget),
    /// The hotkey id, as in `HotkeyTarget::id`
    Released(String),
}

#[derive(Default)]
struct QueueState {
    is_stopping: bool,
    sender: Option<Sender<HotkeyEvent>>,
}

#[derive(Default)]
pub(crate) struct HotkeyQueue(Mutex<QueueState>);

impl StoppableService for HotkeyQueue {
    fn stop(&self) {
        let mut state = self.0.locked();
        state.is_stopping = true;
        drop(state.sender.take());
    }

    fn wait_until(&self, _deadline: Instant) -> bool {
        true
    }
}

pub(super) fn start(app: &AppHandle) -> Result<(), AppError> {
    let (sender, receiver) = channel::<HotkeyEvent>();
    let handle = app.clone();
    app.state::<BackgroundServices>()
        .spawn_thread("hotkey-events", move |stop| {
            for event in receiver {
                if stop.is_stopped() {
                    break;
                }
                handle_event(&handle, event);
            }
        })?;
    let queue = app.state::<HotkeyQueue>();
    let mut state = queue.0.locked();
    if !state.is_stopping {
        state.sender = Some(sender);
    }
    Ok(())
}

/// Queues a hotkey event; without a running queue it is handled at once, unless stopping.
pub(crate) fn dispatch(app: &AppHandle, event: HotkeyEvent) {
    if app
        .try_state::<AppState>()
        .is_some_and(|state| state.is_quitting())
    {
        return;
    }
    let event = {
        let queue = app.state::<HotkeyQueue>();
        let state = queue.0.locked();
        if state.is_stopping {
            return;
        }
        match state.sender.as_ref() {
            Some(sender) => match sender.send(event) {
                Ok(()) => return,
                Err(error) => error.0,
            },
            None => event,
        }
    };
    handle_event(app, event);
}

fn handle_event(app: &AppHandle, event: HotkeyEvent) {
    match event {
        HotkeyEvent::Pressed(target) => {
            if let Err(error) = voice_gesture::pressed(app, &target, &target.id()) {
                log::error!("Hotkey activation failed: {error}");
            }
        }
        HotkeyEvent::Released(id) => voice_gesture::released(app, &id),
    }
}
