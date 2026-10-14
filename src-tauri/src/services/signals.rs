//! Handles termination signals (SIGTERM, SIGINT, Ctrl+C) to trigger
//! graceful application shutdown.

use tauri::AppHandle;

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
            request_exit(&app);

            // the handlers stay installed: a second signal is the user's way
            // out of a shutdown that hangs
            tokio::select! {
                _ = sigterm.recv() => {}
                _ = sigint.recv() => {}
            }
        }

        #[cfg(not(unix))]
        {
            if let Err(error) = tokio::signal::ctrl_c().await {
                log::warn!("Could not register Ctrl+C handler: {error}");
                return;
            }
            log::info!("Received Ctrl+C; initiating graceful shutdown");
            request_exit(&app);
            if tokio::signal::ctrl_c().await.is_err() {
                return;
            }
        }

        log::warn!("Received a second termination signal; exiting at once");
        std::process::exit(130);
    });
}

fn request_exit(app: &AppHandle) {
    app.exit(0);
}
