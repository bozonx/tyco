use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tyco_activation_protocol::{Request, Response, RunRequest};
use zbus::message::{Header, Message};
use zbus::names::{BusName, ErrorName, OwnedErrorName, OwnedUniqueName};
use zbus::{interface, Connection, DBusError};

use crate::services::activation::ActivationSource;
use crate::services::platform::linux::kwin;
use crate::services::platform::session;
use crate::services::platform::window_tracker::{self, tracker, WindowKind};
use crate::services::{external::api, runtime};

const MESSAGE_PATH: &str = "/org/tyco/Object";
const MESSAGE_DEST: &str = "org.tyco.Service";
pub(super) const KWIN_SERVICE: &str = "org.kde.KWin";
/// Errors are named after the machine codes of the API, e.g.
/// `org.tyco.Error.AccessDenied`.
const ERROR_PREFIX: &str = "org.tyco.Error";

/// Serves the D-Bus interface on a dedicated thread. A failure here (no session
/// bus, the name already taken by another instance) must not take the app down:
/// the rest of the UI works without the hotkey integration.
pub fn spawn_dbus_server(app: AppHandle) -> Result<(), crate::errors::AppError> {
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    services.spawn_async(async move {
        let app = handle;
        let connection = async {
            zbus::connection::Builder::session()?
                .name(MESSAGE_DEST)?
                .serve_at(MESSAGE_PATH, TycoDbus { app: app.clone() })?
                .serve_at(MESSAGE_PATH, TycoKwin { app: app.clone() })?
                .build()
                .await
        }
        .await;
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
            let own_class = gtk::glib::prgname().unwrap_or_default();
            if let Err(error) = app
                .state::<crate::services::background::BackgroundServices>()
                .spawn_thread("kwin-window-tracker", move |stop| {
                    kwin::supervise_tracker(&own_class, &stop)
                })
            {
                log::warn!("Could not start KWin window tracker: {error}");
            }
        }
        std::future::pending::<()>().await;
    })
}

/// A shortcut-friendly launcher: it opens windows and starts commands as a
/// user would. Discovery, background runs, jobs and quitting are left to
/// `tyco-ctl`, see `docs/external-control.md`.
struct TycoDbus {
    app: AppHandle,
}

#[interface(name = "org.tyco.Interface")]
impl TycoDbus {
    /// Opens the window of `mode`.
    async fn open(&self, mode: String) -> Result<(), ApiError> {
        self.open_with(mode, None, false).await
    }

    /// Opens the window of `mode` with `text` as its input.
    async fn open_with_text(&self, mode: String, text: String) -> Result<(), ApiError> {
        self.open_with(mode, Some(text), false).await
    }

    /// Opens the window of `mode` with the selection of the focused window.
    async fn open_with_selection(&self, mode: String) -> Result<(), ApiError> {
        self.open_with(mode, None, true).await
    }

    /// Runs the library command `id` as the command launcher does: it asks
    /// for input or confirmation when needed and returns the result to the caller.
    async fn run_command(&self, id: String) -> Result<(), ApiError> {
        self.run(RunRequest {
            target: id,
            interactive: true,
            ..Default::default()
        })
        .await
    }

    /// Replaces the selection of the focused window with the output of the
    /// library command `id`.
    async fn replace_selection(&self, id: String) -> Result<(), ApiError> {
        self.run(RunRequest {
            target: id,
            selection: true,
            replace: true,
            interactive: true,
            ..Default::default()
        })
        .await
    }

    /// Corrects the selection of the focused window in place, as the inline
    /// correction hotkey does.
    async fn correct_selection(&self) -> Result<(), ApiError> {
        self.dispatch(Request::ReplaceSelection {
            action: String::from("correction"),
        })
        .await
    }
}

impl TycoDbus {
    async fn open_with(
        &self,
        mode: String,
        text: Option<String>,
        selection: bool,
    ) -> Result<(), ApiError> {
        self.dispatch(Request::Open {
            mode,
            text,
            selection,
        })
        .await
    }

    async fn run(&self, request: RunRequest) -> Result<(), ApiError> {
        self.dispatch(Request::Run { request }).await
    }

    /// Selection capture and window activation block, so they run off the
    /// bus thread: the KWin reports must keep coming in meanwhile.
    async fn dispatch(&self, request: Request) -> Result<(), ApiError> {
        let app = self.app.clone();
        let services = self
            .app
            .state::<crate::services::background::BackgroundServices>();
        let response = services
            .run_blocking(move || api::dispatch(&app, request, ActivationSource::Dbus))
            .await
            .unwrap_or_else(|error| Response::error(error.to_string()));
        if response.success {
            Ok(())
        } else {
            Err(ApiError::from(response))
        }
    }
}

/// A failed call, named `org.tyco.Error.<code>`.
#[derive(Debug)]
struct ApiError {
    name: OwnedErrorName,
    message: String,
}

impl From<Response> for ApiError {
    fn from(response: Response) -> Self {
        let code = response.code.as_deref().unwrap_or("Failed");
        let name =
            OwnedErrorName::try_from(format!("{ERROR_PREFIX}.{code}")).unwrap_or_else(|_| {
                ErrorName::from_static_str_unchecked("org.tyco.Error.Failed").into()
            });
        Self {
            name,
            message: response.error.unwrap_or_default(),
        }
    }
}

impl DBusError for ApiError {
    // zbus' own `DBusError` derive builds the reply the same way.
    fn create_reply(&self, call: &Header<'_>) -> zbus::Result<Message> {
        Message::error(call, self.name())?.build(&self.message)
    }

    fn name(&self) -> ErrorName<'_> {
        self.name.as_ref()
    }

    fn description(&self) -> Option<&str> {
        Some(&self.message)
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use tyco_activation_protocol::ErrorCode;

    #[test]
    fn errors_are_named_after_their_codes() {
        let error = ApiError::from(Response::coded_error(ErrorCode::AccessDenied, "blocked"));
        assert_eq!(error.name().as_str(), "org.tyco.Error.AccessDenied");
        assert_eq!(error.description(), Some("blocked"));
        let error = ApiError::from(Response {
            code: Some("not a name!".into()),
            ..Response::error("odd")
        });
        assert_eq!(error.name().as_str(), "org.tyco.Error.Failed");
    }
}
