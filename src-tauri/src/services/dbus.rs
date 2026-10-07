use std::sync::Mutex;
use std::thread;

use tauri::AppHandle;
use zbus::message::Header;
use zbus::names::{BusName, OwnedUniqueName};
use zbus::{interface, Connection};

use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::platform::linux::kwin;
use crate::services::platform::session;
use crate::services::platform::window_tracker::{self, tracker, WindowKind};
use crate::services::{external_commands, runtime, selection_replace};
use crate::state::AppState;
use tauri::Manager;

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
                if session::current().is_kde_wayland() {
                    window_tracker::finish_startup();
                }
                return;
            }
        };

        log::info!("D-Bus server listening on {MESSAGE_DEST}{MESSAGE_PATH}");

        if session::current().is_kde_wayland() {
            // Wayland gives GTK windows the program name as their app id
            let own_class = gtk::glib::prgname().unwrap_or_default();
            kwin::supervise_tracker(&own_class);
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

    /// Runs a command of the library, found by its id or name; `text` is
    /// empty when there is none. See `external_commands`.
    async fn run_command(&self, command: &str, text: &str) -> zbus::fdo::Result<()> {
        let text = (!text.is_empty()).then(|| text.to_owned());
        external_commands::run(&self.app, command, text, ActivationSource::Dbus)
            .map_err(|error| zbus::fdo::Error::Failed(error.to_string()))
    }

    /// The commands that may be run from outside: a JSON array of
    /// `{ id, name, input }`.
    async fn list_commands(&self) -> zbus::fdo::Result<String> {
        let state = self.app.state::<AppState>();
        Ok(external_commands::list(
            &state.params().user_config,
            state.tool_catalog().as_ref(),
        ))
    }

    /// Reported by the KWin tracker script, see `platform::linux::kwin`.
    #[zbus(name = "KwinWindowActivated")]
    async fn kwin_window_activated(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        seq: String,
        id: String,
        kind: String,
        class: String,
    ) -> zbus::fdo::Result<()> {
        ensure_sent_by_kwin(&header, connection).await?;
        let applied = tracker().window_activated(&seq, &id, WindowKind::parse(&kind), &class);
        if applied {
            if let Err(error) = runtime::follow_target_window(&self.app) {
                log::warn!("Could not follow the target window: {error}");
            }
        }
        Ok(())
    }

    #[zbus(name = "KwinWindowClosed")]
    async fn kwin_window_closed(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        seq: String,
        id: String,
    ) -> zbus::fdo::Result<()> {
        ensure_sent_by_kwin(&header, connection).await?;
        if tracker().window_closed(&seq, &id) {
            self.forget_target_window(&id);
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
        tracker().window_missing(&id);
        // the closing of the window may have gone unreported
        self.forget_target_window(&id);
        Ok(())
    }

    #[zbus(name = "Ping")]
    async fn ping(&self) -> zbus::fdo::Result<&str> {
        Ok(MESSAGE_INTERFACE)
    }

    #[zbus(name = "Quit")]
    async fn quit(&self) -> zbus::fdo::Result<()> {
        let state = self.app.state::<AppState>();
        state.set_quitting(true);
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            app.exit(0);
        });
        Ok(())
    }
}

impl TycoDbus {
    fn forget_target_window(&self, id: &str) {
        if let Err(error) = runtime::forget_target_window(&self.app, id) {
            log::warn!("Could not forget the closed target window: {error}");
        }
    }
}

/// Window reports pick the insertion target, so only KWin may send them. The
/// owner of the KWin name is looked up again only when a report comes from
/// someone else, so a focus change costs no extra round trip.
async fn ensure_sent_by_kwin(
    header: &Header<'_>,
    connection: &Connection,
) -> zbus::fdo::Result<()> {
    static KWIN_OWNER: Mutex<Option<OwnedUniqueName>> = Mutex::new(None);

    let Some(sender) = header.sender() else {
        return Err(not_kwin());
    };
    let is_cached_owner = |owner: &Mutex<Option<OwnedUniqueName>>| {
        owner
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .is_some_and(|owner| owner.as_ref() == *sender)
    };
    if is_cached_owner(&KWIN_OWNER) {
        return Ok(());
    }
    let owner = zbus::fdo::DBusProxy::new(connection)
        .await?
        .get_name_owner(BusName::from_static_str(KWIN_SERVICE).map_err(zbus::Error::from)?)
        .await?;
    let is_kwin = owner.as_ref() == *sender;
    *KWIN_OWNER.lock().unwrap_or_else(|error| error.into_inner()) = Some(owner);
    if is_kwin {
        Ok(())
    } else {
        Err(not_kwin())
    }
}

fn not_kwin() -> zbus::fdo::Error {
    zbus::fdo::Error::AccessDenied(String::from("Only KWin may report windows"))
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
