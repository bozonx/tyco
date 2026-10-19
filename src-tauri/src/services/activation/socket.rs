//! Cross-platform, authenticated local control transport with owned shutdown.
use crate::errors::AppError;
use crate::services::{activation::ActivationSource, background::BackgroundServices};
use tauri::{AppHandle, Manager};

pub fn spawn_server(app: AppHandle) -> Result<(), AppError> {
    let services = app.state::<BackgroundServices>();
    let handle = app.clone();
    services.spawn_thread("local-control", move |stop| {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                log::error!("Could not create local control runtime: {error}");
                return;
            }
        };
        let handler_stop = stop.clone();
        let result = runtime.block_on(tyco_activation_protocol::transport::serve_until(
            move |request| {
                let services = handle.state::<BackgroundServices>();
                let lease = services.register();
                if handler_stop.is_stopped() || lease.is_err() {
                    return tyco_activation_protocol::Response::coded_error(
                        tyco_activation_protocol::ErrorCode::Unavailable,
                        "Application is stopping",
                    );
                }
                let _lease = lease.expect("admitted local control handler");
                crate::services::external::api::dispatch(&handle, request, ActivationSource::Cli)
            },
            stop.cancelled(),
        ));
        if let Err(error) = result {
            log::error!("Local control IPC is unavailable: {error}");
        }
        // A blocking handler may be waiting for an external OS API. It must not
        // prevent the application-wide shutdown deadline from being honored.
        runtime.shutdown_timeout(std::time::Duration::from_secs(1));
    })
}
