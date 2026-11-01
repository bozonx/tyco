//! Foreign windows on wlroots compositors (Sway, Hyprland, labwc, Wayfire,
//! river, niri and others) through `zwlr_foreign_toplevel_management_v1`.
//! The compositor lists every toplevel window with its application id and
//! state, tells when one gets activated, and activates one on request.
//!
//! The protocol knows toplevels only: a layer-shell panel of Tyco takes the
//! keyboard without a report, so the tracker runs with
//! `OwnFocus::ToplevelsOnly`. Window ids are numbers this process hands out;
//! the protocol has none of its own.

use std::collections::HashMap;
use std::os::fd::AsRawFd;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::{wl_registry, wl_seat};
use wayland_client::{event_created_child, Connection, Dispatch, EventQueue, Proxy, QueueHandle};
use wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_handle_v1::{
    self, ZwlrForeignToplevelHandleV1,
};
use wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_manager_v1::{
    self, ZwlrForeignToplevelManagerV1,
};

use super::readiness::{wait_readable, Readiness, StopFd};
use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::platform::window_tracker::{
    finish_startup, new_session, tracker, OwnFocus, TrackerChange, WindowKind,
};

/// How long the compositor may take to focus a window it was asked to.
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(2);
/// Version 3 adds the parent event, which Tyco does not need.
const MANAGER_VERSION: u32 = 3;

/// The window handles, so that another thread can activate one.
struct Activator {
    connection: Connection,
    seat: wl_seat::WlSeat,
    handles: HashMap<String, ZwlrForeignToplevelHandleV1>,
}

fn activator() -> &'static Mutex<Option<Activator>> {
    static ACTIVATOR: OnceLock<Mutex<Option<Activator>>> = OnceLock::new();
    ACTIVATOR.get_or_init(|| Mutex::new(None))
}

/// Tracks windows on a thread of its own for the lifetime of the process,
/// when the compositor offers the protocol. `own_names` are the application
/// ids Tyco windows may carry; `on_change` hears about every change the
/// tracker applied.
pub fn spawn_tracker(
    services: &crate::services::background::BackgroundServices,
    own_names: Vec<String>,
    on_change: impl Fn(TrackerChange) + Send + 'static,
) -> Result<(), AppError> {
    services.spawn_thread("wlr-window-tracker", move |stop| {
        if let Err(error) = run(own_names, &on_change, &stop) {
            log::info!("No foreign toplevel tracking on this compositor: {error}");
        }
        tracker().reset(false, String::new());
        *activator().locked() = None;
        finish_startup();
    })
}

fn run(
    own_names: Vec<String>,
    on_change: &dyn Fn(TrackerChange),
    stop: &crate::services::background::StopToken,
) -> Result<(), AppError> {
    let connection = Connection::connect_to_env().map_err(wayland_error)?;
    let (globals, mut queue) =
        registry_queue_init::<Toplevels>(&connection).map_err(wayland_error)?;
    let handle = queue.handle();
    let seat: wl_seat::WlSeat = globals.bind(&handle, 1..=1, ()).map_err(wayland_error)?;
    let _manager: ZwlrForeignToplevelManagerV1 = globals
        .bind(&handle, 1..=MANAGER_VERSION, ())
        .map_err(wayland_error)?;
    let stop_fd = StopFd::new(stop)?;

    let session = new_session();
    tracker().reset_with(true, session.clone(), OwnFocus::ToplevelsOnly);
    *activator().locked() = Some(Activator {
        connection: connection.clone(),
        seat,
        handles: HashMap::new(),
    });
    let mut state = Toplevels {
        own_names: own_names
            .into_iter()
            .filter(|name| !name.is_empty())
            .map(|name| name.to_ascii_lowercase())
            .collect(),
        session,
        seq: 0,
        windows: HashMap::new(),
        active_id: None,
        changes: Vec::new(),
        finished: false,
    };
    // the compositor lists the windows it has, each closed by a done event
    queue.roundtrip(&mut state).map_err(wayland_error)?;
    if state.active_id.is_none() {
        let seq = state.next_seq();
        tracker().window_activated(&seq, "", WindowKind::Other, "");
    }
    state.changes.clear();
    finish_startup();
    log::info!("Tracking foreign windows with the wlr foreign toplevel protocol");

    loop {
        dispatch(&mut queue, &mut state)?;
        for change in state.changes.drain(..) {
            on_change(change);
        }
        if state.finished {
            return Err(AppError::ServiceUnavailable(String::from(
                "The compositor stopped listing windows",
            )));
        }
        let Some(guard) = queue.prepare_read() else {
            continue;
        };
        match wait_readable(guard.connection_fd().as_raw_fd(), &stop_fd)? {
            Readiness::Stopped => return Ok(()),
            Readiness::Readable => match guard.read() {
                Ok(_) => {}
                Err(wayland_client::backend::WaylandError::Io(error))
                    if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(error) => return Err(wayland_error(error)),
            },
        }
    }
}

fn dispatch(queue: &mut EventQueue<Toplevels>, state: &mut Toplevels) -> Result<(), AppError> {
    queue.dispatch_pending(state).map_err(wayland_error)?;
    queue.flush().map_err(wayland_error)
}

/// Asks the compositor to activate the window and waits until it reports it
/// activated.
pub fn activate_window(id: &str) -> Result<(), AppError> {
    let requested = {
        let activator = activator().locked();
        let Some(activator) = activator.as_ref() else {
            return Err(AppError::ServiceUnavailable(String::from(
                "The wlr window tracker is not running",
            )));
        };
        match activator.handles.get(id) {
            Some(handle) => {
                tracker().forget_missing();
                handle.activate(&activator.seat);
                activator.connection.flush().map_err(wayland_error)?;
                true
            }
            None => false,
        }
    };
    if !requested {
        tracker().window_missing(id);
        return Err(AppError::Stale(String::from(
            "The target window has been closed",
        )));
    }
    tracker().wait_until_active(id, ACTIVATION_TIMEOUT)
}

/// A window with the state of its last done event, and the one coming.
#[derive(Default)]
struct Toplevel {
    id: String,
    app_id: String,
    activated: bool,
    pending_app_id: Option<String>,
    pending_activated: Option<bool>,
}

struct Toplevels {
    own_names: Vec<String>,
    session: String,
    seq: u64,
    windows: HashMap<wayland_client::backend::ObjectId, Toplevel>,
    /// The window last reported active.
    active_id: Option<String>,
    /// Changes for the app, handed over outside the dispatch.
    changes: Vec<TrackerChange>,
    finished: bool,
}

impl Toplevels {
    fn next_seq(&mut self) -> String {
        self.seq += 1;
        format!("{}:{}", self.session, self.seq)
    }

    fn kind(&self, app_id: &str) -> WindowKind {
        window_kind(&self.own_names, app_id)
    }

    /// Applies the state a done event confirms, and reports what changed.
    fn window_done(&mut self, object: &wayland_client::backend::ObjectId) {
        let Some(window) = self.windows.get_mut(object) else {
            return;
        };
        if let Some(app_id) = window.pending_app_id.take() {
            window.app_id = app_id;
        }
        if let Some(activated) = window.pending_activated.take() {
            window.activated = activated;
        }
        let (id, app_id, activated) = (window.id.clone(), window.app_id.clone(), window.activated);
        let is_active = self.active_id.as_deref() == Some(id.as_str());
        if activated && !is_active {
            let seq = self.next_seq();
            let kind = self.kind(&app_id);
            self.active_id = Some(id.clone());
            if tracker().window_activated(&seq, &id, kind, &app_id) {
                self.changes.push(TrackerChange::Activated);
            }
        } else if !activated && is_active {
            // the next window, if any, reports its activation on its own
            let seq = self.next_seq();
            self.active_id = None;
            tracker().window_activated(&seq, "", WindowKind::Other, "");
        }
    }

    fn window_closed(&mut self, object: &wayland_client::backend::ObjectId) {
        let Some(window) = self.windows.remove(object) else {
            return;
        };
        if let Some(activator) = activator().locked().as_mut() {
            activator.handles.remove(&window.id);
        }
        if self.active_id.as_deref() == Some(window.id.as_str()) {
            self.active_id = None;
        }
        let seq = self.next_seq();
        if tracker().window_closed(&seq, &window.id) {
            self.changes.push(TrackerChange::Closed(window.id));
        }
    }
}

/// Tyco's own windows carry its program name or its application id.
fn window_kind(own_names: &[String], app_id: &str) -> WindowKind {
    if own_names
        .iter()
        .any(|name| app_id.eq_ignore_ascii_case(name))
    {
        WindowKind::Own
    } else {
        WindowKind::Foreign
    }
}

/// The `zwlr_foreign_toplevel_handle_v1.state` entry of an activated window.
fn is_activated(states: &[u8]) -> bool {
    let activated = zwlr_foreign_toplevel_handle_v1::State::Activated as u32;
    states
        .as_chunks::<4>()
        .0
        .iter()
        .any(|chunk| u32::from_ne_bytes(*chunk) == activated)
}

fn next_window_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed).to_string()
}

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for Toplevels {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<wl_seat::WlSeat, ()> for Toplevels {
    fn event(
        _: &mut Self,
        _: &wl_seat::WlSeat,
        _: wl_seat::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<ZwlrForeignToplevelManagerV1, ()> for Toplevels {
    fn event(
        state: &mut Self,
        _: &ZwlrForeignToplevelManagerV1,
        event: zwlr_foreign_toplevel_manager_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            zwlr_foreign_toplevel_manager_v1::Event::Toplevel { toplevel } => {
                let id = next_window_id();
                if let Some(activator) = activator().locked().as_mut() {
                    activator.handles.insert(id.clone(), toplevel.clone());
                }
                state.windows.insert(
                    toplevel.id(),
                    Toplevel {
                        id,
                        ..Toplevel::default()
                    },
                );
            }
            zwlr_foreign_toplevel_manager_v1::Event::Finished => state.finished = true,
            _ => {}
        }
    }

    event_created_child!(Toplevels, ZwlrForeignToplevelManagerV1, [
        zwlr_foreign_toplevel_manager_v1::EVT_TOPLEVEL_OPCODE => (ZwlrForeignToplevelHandleV1, ()),
    ]);
}

impl Dispatch<ZwlrForeignToplevelHandleV1, ()> for Toplevels {
    fn event(
        state: &mut Self,
        handle: &ZwlrForeignToplevelHandleV1,
        event: zwlr_foreign_toplevel_handle_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let object = handle.id();
        match event {
            zwlr_foreign_toplevel_handle_v1::Event::AppId { app_id } => {
                if let Some(window) = state.windows.get_mut(&object) {
                    window.pending_app_id = Some(app_id);
                }
            }
            zwlr_foreign_toplevel_handle_v1::Event::State { state: states } => {
                if let Some(window) = state.windows.get_mut(&object) {
                    window.pending_activated = Some(is_activated(&states));
                }
            }
            zwlr_foreign_toplevel_handle_v1::Event::Done => state.window_done(&object),
            zwlr_foreign_toplevel_handle_v1::Event::Closed => {
                state.window_closed(&object);
                handle.destroy();
            }
            _ => {}
        }
    }
}

fn wayland_error(error: impl std::fmt::Display) -> AppError {
    AppError::ServiceUnavailable(format!("Wayland: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn states(values: &[u32]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| value.to_ne_bytes())
            .collect()
    }

    #[test]
    fn reads_the_activated_state() {
        // maximized 0, minimized 1, activated 2, fullscreen 3
        assert!(is_activated(&states(&[0, 2])));
        assert!(!is_activated(&states(&[0, 1, 3])));
        assert!(!is_activated(&[]));
    }

    #[test]
    fn tells_own_windows_by_application_id() {
        let own = [String::from("tyco"), String::from("com.tyco.app")];
        assert_eq!(window_kind(&own, "Tyco"), WindowKind::Own);
        assert_eq!(window_kind(&own, "com.tyco.app"), WindowKind::Own);
        assert_eq!(
            window_kind(&own, "org.gnome.TextEditor"),
            WindowKind::Foreign
        );
        assert_eq!(window_kind(&own, ""), WindowKind::Foreign);
    }

    #[test]
    fn window_ids_differ() {
        assert_ne!(next_window_id(), next_window_id());
    }
}
