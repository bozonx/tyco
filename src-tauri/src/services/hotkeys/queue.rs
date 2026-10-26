//! Runs hotkey presses and releases off the thread that reports them, in the
//! order they came. The global shortcut handler runs on the main thread on
//! macOS and Windows, where an activation would block the interface, and the
//! portal reports presses and releases on separate signal streams.
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};

use super::{voice_gesture, HotkeyTarget};
use crate::errors::AppError;
use crate::locks::MutexExt;

pub(crate) enum HotkeyEvent {
    Pressed(HotkeyTarget),
    /// The hotkey id, as in `HotkeyTarget::id`
    Released(String),
}

#[derive(Default)]
pub(crate) struct HotkeyQueue(OnceLock<Mutex<Sender<HotkeyEvent>>>);

pub(super) fn start(app: &AppHandle) -> Result<(), AppError> {
    let (sender, receiver) = channel::<HotkeyEvent>();
    let handle = app.clone();
    std::thread::Builder::new()
        .name(String::from("hotkey-events"))
        .spawn(move || {
            for event in receiver {
                handle_event(&handle, event);
            }
        })
        .map_err(|error| AppError::Failed(format!("Could not start hotkey events: {error}")))?;
    let _ = app.state::<HotkeyQueue>().0.set(Mutex::new(sender));
    Ok(())
}

/// Queues a hotkey event; without a running queue it is handled at once.
pub(crate) fn dispatch(app: &AppHandle, event: HotkeyEvent) {
    let event = match app.state::<HotkeyQueue>().0.get() {
        Some(sender) => match sender.locked().send(event) {
            Ok(()) => return,
            Err(error) => error.0,
        },
        None => event,
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
