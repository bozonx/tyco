//! Handles termination signals (SIGTERM, SIGINT, Ctrl+C) to trigger
//! graceful application shutdown.

use tauri::{AppHandle, Manager};

use crate::state::AppState;

pub fn spawn_signal_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};

            let mut sigterm = match signal(SignalKind::terminate()) {
                Ok(stream) => stream,
                Err(error) => {
                    log::warn!("Could not register SIGTERM handler: {error}");
                    return;
                }
            };

            let mut sigint = match signal(SignalKind::interrupt()) {
                Ok(stream) => stream,
                Err(error) => {
                    log::warn!("Could not register SIGINT handler: {error}");
                    return;
                }
            };

            tokio::select! {
                _ = sigterm.recv() => {
                    log::info!("Received SIGTERM; initiating graceful shutdown");
                }
                _ = sigint.recv() => {
                    log::info!("Received SIGINT; initiating graceful shutdown");
                }
            }
        }

        #[cfg(not(unix))]
        {
            if let Err(error) = tokio::signal::ctrl_c().await {
                log::warn!("Could not register Ctrl+C handler: {error}");
                return;
            }
            log::info!("Received Ctrl+C; initiating graceful shutdown");
        }

        if let Some(state) = app.try_state::<AppState>() {
            state.set_quitting(true);
        }
        app.exit(0);
    });
}
