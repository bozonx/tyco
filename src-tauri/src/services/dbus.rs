use std::sync::Mutex;
use std::thread;

use tauri::AppHandle;
use zbus::message::Header;
use zbus::names::{BusName, OwnedUniqueName};
use zbus::{interface, Connection};

use crate::services::activation::ActivationSource;
use crate::services::platform::linux::kwin;
use crate::services::platform::session;
use crate::services::platform::window_tracker::{self, tracker, WindowKind};
use crate::services::{external_api, runtime};

const MESSAGE_PATH: &str = "/org/tyco/Object";
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
                .serve_at(MESSAGE_PATH, TycoKwin { app: app.clone() })?
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
    async fn open(&self, mode: &str, text: &str, selection: bool) -> zbus::fdo::Result<()> {
        dbus_result(external_api::dispatch(
            &self.app,
            tyco_activation_protocol::Request::Open {
                mode: mode.into(),
                text: (!selection).then(|| text.to_owned()),
                selection,
            },
            ActivationSource::Dbus,
        ))
        .map(|_| ())
    }

    async fn replace_selection(&self, action: &str) -> zbus::fdo::Result<()> {
        dbus_result(external_api::dispatch(
            &self.app,
            tyco_activation_protocol::Request::Replace {
                action: action.into(),
            },
            ActivationSource::Dbus,
        ))
        .map(|_| ())
    }
}

fn dbus_result(response: tyco_activation_protocol::Response) -> zbus::fdo::Result<String> {
    if response.success {
        return Ok(response.output.unwrap_or_default());
    }
    let message = format!(
        "{}: {}",
        response.code.as_deref().unwrap_or("Failed"),
        response.error.unwrap_or_default()
    );
    Err(match response.code.as_deref() {
        Some("AccessDenied" | "ConfirmationRequired") => zbus::fdo::Error::AccessDenied(message),
        Some("InvalidArgs" | "InvalidInput" | "InputRequired") => {
            zbus::fdo::Error::InvalidArgs(message)
        }
        _ => zbus::fdo::Error::Failed(message),
    })
}

struct TycoKwin {
    app: AppHandle,
}

#[interface(name = "org.tyco.KwinTracker")]
impl TycoKwin {
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
}

impl TycoKwin {
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
