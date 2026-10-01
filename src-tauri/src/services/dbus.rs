use std::thread;

use tauri::AppHandle;
use zbus::message::Header;
use zbus::names::BusName;
use zbus::{interface, Connection};

use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::{kwin_windows, runtime, selection_replace};

const MESSAGE_PATH: &str = "/org/tyco/Object";
const MESSAGE_INTERFACE: &str = "org.tyco.Interface";
const MESSAGE_DEST: &str = "org.tyco.Service";
const KWIN_SERVICE: &str = "org.kde.KWin";

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

        if kwin_windows::is_kde_wayland_session() {
            match kwin_windows::start_tracker() {
                Ok(()) => log::info!("Tracking foreign windows with a KWin script"),
                Err(error) => log::warn!("KWin window tracker is unavailable: {error}"),
            }
        }

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

        let mode = StartMode::parse(mode)
            .map_err(|error| zbus::fdo::Error::InvalidArgs(error.to_string()))?;
        let mut activation = Activation::new(mode, ActivationSource::Dbus);
        activation.window_id = window_id.map(str::to_string);
        activation.selected_text = selected_text.map(str::to_string);
        runtime::activate(&self.app, activation)
            .map_err(|error| zbus::fdo::Error::Failed(error.to_string()))?;

        Ok(())
    }

    /// Replaces the selection in the focused window, see `selection_replace`.
    async fn replace_selection(&self, action: &str) -> zbus::fdo::Result<()> {
        selection_replace::trigger(&self.app, action, selection_replace::TriggerWait::Now)
            .map_err(|error| zbus::fdo::Error::InvalidArgs(error.to_string()))
    }

    /// Reported by the KWin tracker script, see `kwin_windows`.
    #[zbus(name = "KwinWindowActivated")]
    async fn kwin_window_activated(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        id: String,
        kind: String,
        class: String,
    ) -> zbus::fdo::Result<()> {
        ensure_sent_by_kwin(&header, connection).await?;
        kwin_windows::tracker().window_activated(
            &id,
            kwin_windows::WindowKind::parse(&kind),
            &class,
        );
        Ok(())
    }

    #[zbus(name = "KwinWindowClosed")]
    async fn kwin_window_closed(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        id: String,
    ) -> zbus::fdo::Result<()> {
        ensure_sent_by_kwin(&header, connection).await?;
        kwin_windows::tracker().window_closed(&id);
        if let Err(error) = runtime::forget_target_window(&self.app, &id) {
            log::warn!("Could not forget the closed target window: {error}");
        }
        Ok(())
    }

    #[zbus(name = "KwinWindowMissing")]
    async fn kwin_window_missing(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        id: String,
    ) -> zbus::fdo::Result<()> {
        ensure_sent_by_kwin(&header, connection).await?;
        kwin_windows::tracker().window_missing(&id);
        Ok(())
    }

    #[zbus(name = "Ping")]
    async fn ping(&self) -> zbus::fdo::Result<&str> {
        Ok(MESSAGE_INTERFACE)
    }
}

/// Window reports pick the insertion target, so only KWin may send them.
async fn ensure_sent_by_kwin(
    header: &Header<'_>,
    connection: &Connection,
) -> zbus::fdo::Result<()> {
    let owner = zbus::fdo::DBusProxy::new(connection)
        .await?
        .get_name_owner(BusName::from_static_str(KWIN_SERVICE).map_err(zbus::Error::from)?)
        .await?;
    if header.sender() == Some(&*owner) {
        Ok(())
    } else {
        Err(zbus::fdo::Error::AccessDenied(String::from(
            "Only KWin may report windows",
        )))
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
