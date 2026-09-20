use std::thread;

use tauri::{AppHandle, Manager};
use zbus::interface;

use crate::services::runtime;
use crate::state::AppState;

const MESSAGE_PATH: &str = "/org/tyco/Object";
const MESSAGE_INTERFACE: &str = "org.tyco.Interface";
const MESSAGE_DEST: &str = "org.tyco.Service";

/// Serves the D-Bus interface on a dedicated thread. A failure here (no session
/// bus, the name already taken by another instance) must not take the app down:
/// the rest of the UI works without the hotkey integration.
pub fn spawn_dbus_server(app: AppHandle) {
    thread::spawn(move || {
        let runtime = tauri::async_runtime::handle().clone();
        let connection = runtime.block_on(async {
            let interface = TycoDbus { app: app.clone() };

            zbus::ConnectionBuilder::session()?
                .name(MESSAGE_DEST)?
                .serve_at(MESSAGE_PATH, interface)?
                .build()
                .await
        });

        let _connection = match connection {
            Ok(connection) => connection,
            Err(error) => {
                log::error!("D-Bus server is unavailable: {error}");
                return;
            }
        };

        log::info!("D-Bus server listening on {MESSAGE_DEST}{MESSAGE_PATH}");

        // Keep the connection alive for the lifetime of the process.
        loop {
            thread::park();
        }
    });
}

struct TycoDbus {
    app: AppHandle,
}

#[interface(name = "org.tyco.Interface")]
impl TycoDbus {
    async fn switch_mode(&self, message: &str) -> zbus::fdo::Result<()> {
        let (mode, window_id, selected_text) = parse_switch_mode_message(message);

        if let Some(state) = self.app.try_state::<AppState>() {
            state.update_params(|params| {
                params.mode = Some(mode.to_string());
                params.window_id = window_id.map(str::to_string);
                params.selected_text = selected_text.map(str::to_string);
                params.is_window_shown = true;
            });

            let _ = runtime::show_main_window(&self.app, &state, Some(mode));
        }

        if let Some(window) = self.app.get_webview_window(runtime::MAIN_WINDOW_LABEL) {
            let _ = window.show();
            let _ = window.set_focus();
        }

        Ok(())
    }

    #[zbus(name = "Ping")]
    async fn ping(&self) -> zbus::fdo::Result<&str> {
        Ok(MESSAGE_INTERFACE)
    }
}

pub fn parse_switch_mode_message(message: &str) -> (&str, Option<&str>, Option<&str>) {
    let mut parts = message.splitn(3, '|');
    let mode = parts.next().unwrap_or("editor");
    let window_id = parts.next().filter(|value| !value.is_empty());
    let selected_text = parts.next().filter(|value| !value.is_empty());
    (mode, window_id, selected_text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_switch_mode_message_full() {
        let (mode, window_id, selected_text) =
            parse_switch_mode_message("chat|12345|some selected text");
        assert_eq!(mode, "chat");
        assert_eq!(window_id, Some("12345"));
        assert_eq!(selected_text, Some("some selected text"));
    }

    #[test]
    fn test_parse_switch_mode_message_empty_fields() {
        let (mode, window_id, selected_text) = parse_switch_mode_message("editor||");
        assert_eq!(mode, "editor");
        assert_eq!(window_id, None);
        assert_eq!(selected_text, None);
    }

    #[test]
    fn test_parse_switch_mode_message_with_pipes_in_selected_text() {
        let (mode, window_id, selected_text) =
            parse_switch_mode_message("correction|999|text | with | pipes");
        assert_eq!(mode, "correction");
        assert_eq!(window_id, Some("999"));
        assert_eq!(selected_text, Some("text | with | pipes"));
    }
}
