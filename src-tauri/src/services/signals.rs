//! Handles termination signals (`SIGTERM`, `SIGINT`, `SIGHUP` on Unix;
//! console control events on Windows) to trigger graceful application shutdown.

use tauri::AppHandle;

/// Fallback exit status of a process stopped by an interrupt when no POSIX
/// signal number applies (128 + SIGINT).
#[cfg(not(unix))]
const EXIT_CODE_INTERRUPTED: i32 = 130;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SignalEvent {
    name: &'static str,
    force_exit_code: i32,
}

/// Watches OS termination signals for the lifetime of the process.
///
/// Spawned directly on the Tauri async runtime instead of `BackgroundServices`
/// so stopping services during shutdown does not cancel the listener for a
/// second, force-exit signal.
pub fn spawn_signal_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        watch_signals(app).await;
    });
}

async fn watch_signals(app: AppHandle) {
    let Ok(mut signals) = platform_signals::Signals::register() else {
        return;
    };
    let Some(first) = signals.next().await else {
        return;
    };
    log::info!("Received {}; initiating graceful shutdown", first.name);
    request_exit(&app);

    // Keep watching so a second signal forces an immediate exit if shutdown hangs.
    let Some(second) = signals.next().await else {
        return;
    };
    log::warn!(
        "Received a second termination signal ({}); exiting at once",
        second.name
    );
    std::process::exit(second.force_exit_code);
}

fn request_exit(app: &AppHandle) {
    super::runtime::request_exit(app);
}

#[cfg(unix)]
mod platform_signals {
    use super::SignalEvent;
    use tokio::signal::unix::{signal, Signal, SignalKind};

    pub(super) struct Signals {
        sigterm: Signal,
        sigint: Signal,
        sighup: Signal,
    }

    impl Signals {
        pub(super) fn register() -> Result<Self, ()> {
            let sigterm = signal(SignalKind::terminate()).map_err(|error| {
                log::warn!("Could not register SIGTERM handler: {error}");
            })?;
            let sigint = signal(SignalKind::interrupt()).map_err(|error| {
                log::warn!("Could not register SIGINT handler: {error}");
            })?;
            let sighup = signal(SignalKind::hangup()).map_err(|error| {
                log::warn!("Could not register SIGHUP handler: {error}");
            })?;
            Ok(Self {
                sigterm,
                sigint,
                sighup,
            })
        }

        pub(super) async fn next(&mut self) -> Option<SignalEvent> {
            tokio::select! {
                res = self.sigterm.recv() => res.map(|()| unix_event("SIGTERM", libc::SIGTERM)),
                res = self.sigint.recv() => res.map(|()| unix_event("SIGINT", libc::SIGINT)),
                res = self.sighup.recv() => res.map(|()| unix_event("SIGHUP", libc::SIGHUP)),
            }
        }
    }

    pub(super) const fn unix_event(name: &'static str, signo: i32) -> SignalEvent {
        SignalEvent {
            name,
            force_exit_code: 128 + signo,
        }
    }
}

#[cfg(windows)]
mod platform_signals {
    use super::{SignalEvent, EXIT_CODE_INTERRUPTED};
    use tokio::signal::windows::{
        ctrl_break, ctrl_c, ctrl_close, ctrl_logoff, ctrl_shutdown, CtrlBreak, CtrlC, CtrlClose,
        CtrlLogoff, CtrlShutdown,
    };

    pub(super) struct Signals {
        ctrl_c: CtrlC,
        ctrl_break: CtrlBreak,
        ctrl_close: CtrlClose,
        ctrl_logoff: CtrlLogoff,
        ctrl_shutdown: CtrlShutdown,
    }

    impl Signals {
        pub(super) fn register() -> Result<Self, ()> {
            let ctrl_c = ctrl_c().map_err(|error| {
                log::warn!("Could not register Ctrl+C handler: {error}");
            })?;
            let ctrl_break = ctrl_break().map_err(|error| {
                log::warn!("Could not register Ctrl+Break handler: {error}");
            })?;
            let ctrl_close = ctrl_close().map_err(|error| {
                log::warn!("Could not register Ctrl+Close handler: {error}");
            })?;
            let ctrl_logoff = ctrl_logoff().map_err(|error| {
                log::warn!("Could not register Ctrl+Logoff handler: {error}");
            })?;
            let ctrl_shutdown = ctrl_shutdown().map_err(|error| {
                log::warn!("Could not register Ctrl+Shutdown handler: {error}");
            })?;
            Ok(Self {
                ctrl_c,
                ctrl_break,
                ctrl_close,
                ctrl_logoff,
                ctrl_shutdown,
            })
        }

        pub(super) async fn next(&mut self) -> Option<SignalEvent> {
            let event = |name| SignalEvent {
                name,
                force_exit_code: EXIT_CODE_INTERRUPTED,
            };
            tokio::select! {
                res = self.ctrl_c.recv() => res.map(|()| event("Ctrl+C")),
                res = self.ctrl_break.recv() => res.map(|()| event("Ctrl+Break")),
                res = self.ctrl_close.recv() => res.map(|()| event("Ctrl+Close")),
                res = self.ctrl_logoff.recv() => res.map(|()| event("Ctrl+Logoff")),
                res = self.ctrl_shutdown.recv() => res.map(|()| event("Ctrl+Shutdown")),
            }
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform_signals {
    use super::{SignalEvent, EXIT_CODE_INTERRUPTED};

    pub(super) struct Signals;

    impl Signals {
        pub(super) fn register() -> Result<Self, ()> {
            Ok(Self)
        }

        pub(super) async fn next(&mut self) -> Option<SignalEvent> {
            match tokio::signal::ctrl_c().await {
                Ok(()) => Some(SignalEvent {
                    name: "Ctrl+C",
                    force_exit_code: EXIT_CODE_INTERRUPTED,
                }),
                Err(error) => {
                    log::warn!("Could not register Ctrl+C handler: {error}");
                    None
                }
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::platform_signals::unix_event;

    #[test]
    fn unix_force_exit_codes_follow_128_plus_signal_convention() {
        assert_eq!(unix_event("SIGHUP", libc::SIGHUP).force_exit_code, 129);
        assert_eq!(unix_event("SIGINT", libc::SIGINT).force_exit_code, 130);
        assert_eq!(unix_event("SIGTERM", libc::SIGTERM).force_exit_code, 143);
    }
}
