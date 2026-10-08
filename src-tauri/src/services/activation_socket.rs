//! Cross-platform, authenticated local control transport.
use crate::services::activation::ActivationSource;
use tauri::AppHandle;

pub fn spawn_server(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(error) = tyco_activation_protocol::transport::serve(move |request| {
            super::external_api::dispatch(&app, request, ActivationSource::Cli)
        }) {
            log::error!("Local control IPC is unavailable: {error}");
        }
    });
}
