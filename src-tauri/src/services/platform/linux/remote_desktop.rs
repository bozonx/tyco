//! Pressing keys through the RemoteDesktop portal. It is the way a Flatpak,
//! or a system without ydotool, presses keys on KDE Plasma 6 and GNOME: the
//! compositor asks the user once, and a restore token lets later sessions
//! start without asking again.
//!
//! A worker thread owns the session. It opens it on the first key press,
//! keeps it while keys are pressed, and closes it after a while without any:
//! the desktop shows an open session as remote control in progress.

use crate::locks::MutexExt;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use ashpd::desktop::remote_desktop::{
    DeviceType, KeyState, RemoteDesktop, SelectDevicesOptions, StartOptions,
};
use ashpd::desktop::{PersistMode, Session};

use crate::errors::AppError;

/// How long the session stays open after the last key press.
const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// How long a portal call without a dialog may take.
const CALL_TIMEOUT: Duration = Duration::from_secs(3);
/// How long the user may take to answer the permission dialog.
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(120);
/// How long the window under the permission dialog takes to get the focus back.
const DIALOG_FOCUS_SETTLE_DELAY: Duration = Duration::from_millis(400);
const TOKEN_FILE: &str = "remote-desktop.token";

/// What the portal can do for Tyco now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PortalState {
    /// Keys can be pressed; the first press may still start a session.
    Ready,
    /// The portal is there, but the user has not allowed keyboard control yet.
    NeedsPermission,
    Unavailable(String),
}

/// A key and whether it goes down or up, as a Linux input event code.
pub type KeyEvent = (u16, bool);

enum Request {
    Probe(Sender<PortalState>),
    Start(Sender<Result<(), AppError>>),
    Press(Vec<KeyEvent>, Sender<Result<(), AppError>>),
}

struct Config {
    /// Where the restore token is kept. Without it the user is asked on
    /// every start of Tyco.
    state_dir: PathBuf,
    /// Names Tyco in the dialog; the portal keeps the permission per app.
    app_id: String,
}

static CONFIG: OnceLock<Config> = OnceLock::new();

pub fn init(state_dir: PathBuf, app_id: String) {
    let _ = CONFIG.set(Config { state_dir, app_id });
}

pub fn state() -> PortalState {
    call(Request::Probe, CALL_TIMEOUT)
        .unwrap_or_else(|error| PortalState::Unavailable(error.to_string()))
}

/// Opens a session, asking the user when no permission is stored.
pub fn request_permission() -> Result<(), AppError> {
    call(Request::Start, PERMISSION_TIMEOUT)?
}

/// Presses `keys` in the focused window. The first press of a run may show
/// the permission dialog, so it waits as long as the user may take.
pub fn press(keys: Vec<KeyEvent>) -> Result<(), AppError> {
    call(|reply| Request::Press(keys, reply), PERMISSION_TIMEOUT)?
}

fn call<T>(request: impl FnOnce(Sender<T>) -> Request, timeout: Duration) -> Result<T, AppError> {
    static WORKER: Mutex<Option<Sender<Request>>> = Mutex::new(None);

    let (reply, answer) = mpsc::channel();
    let request = request(reply);
    {
        let mut worker = WORKER.locked();
        let sent = match worker.as_ref() {
            Some(sender) => match sender.send(request) {
                Ok(()) => None,
                Err(mpsc::SendError(returned)) => Some(returned),
            },
            None => Some(request),
        };
        // no worker yet, or it stopped: a new one takes the request
        if let Some(request) = sent {
            let (sender, receiver) = mpsc::channel();
            spawn_worker(receiver)?;
            sender.send(request).map_err(|_| worker_gone())?;
            *worker = Some(sender);
        }
    }
    answer.recv_timeout(timeout).map_err(|_| {
        AppError::ServiceUnavailable(String::from(
            "The RemoteDesktop portal did not answer in time",
        ))
    })
}

fn worker_gone() -> AppError {
    AppError::ServiceUnavailable(String::from("The RemoteDesktop portal worker stopped"))
}

fn spawn_worker(receiver: Receiver<Request>) -> Result<(), AppError> {
    std::thread::Builder::new()
        .name(String::from("remote-desktop-portal"))
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    log::error!("Could not start the RemoteDesktop portal worker: {error}");
                    return;
                }
            };
            let mut worker = Worker::default();
            loop {
                let received = if worker.session.is_some() {
                    receiver.recv_timeout(SESSION_IDLE_TIMEOUT)
                } else {
                    receiver.recv().map_err(RecvTimeoutError::from)
                };
                match received {
                    Ok(request) => runtime.block_on(worker.handle(request)),
                    Err(RecvTimeoutError::Timeout) => runtime.block_on(worker.close()),
                    Err(RecvTimeoutError::Disconnected) => {
                        runtime.block_on(worker.close());
                        return;
                    }
                }
            }
        })
        .map(|_| ())
        .map_err(|error| AppError::Failed(format!("Could not start the portal worker: {error}")))
}

#[derive(Default)]
struct Worker {
    portal: Option<RemoteDesktop>,
    session: Option<Session<RemoteDesktop>>,
}

impl Worker {
    async fn handle(&mut self, request: Request) {
        match request {
            Request::Probe(reply) => {
                let _ = reply.send(self.probe().await);
            }
            Request::Start(reply) => {
                let _ = reply.send(self.ensure_session().await);
            }
            Request::Press(keys, reply) => {
                let _ = reply.send(self.press(&keys).await);
            }
        }
    }

    /// A connection of its own: the shared one of ashpd would run on this
    /// worker's runtime, which only runs while a request is handled.
    async fn portal(&mut self) -> Result<&RemoteDesktop, AppError> {
        if self.portal.is_none() {
            let connection = with_timeout(async { Ok(zbus::Connection::session().await?) }).await?;
            register_app(&connection).await;
            let portal = with_timeout(RemoteDesktop::with_connection(connection)).await?;
            self.portal = Some(portal);
        }
        Ok(self.portal.as_ref().expect("the portal was set above"))
    }

    async fn probe(&mut self) -> PortalState {
        if self.session.is_some() {
            return PortalState::Ready;
        }
        let portal = match self.portal().await {
            Ok(portal) => portal,
            Err(error) => return PortalState::Unavailable(error.to_string()),
        };
        match with_timeout(portal.available_device_types()).await {
            Ok(types) if types.contains(DeviceType::Keyboard) => {}
            Ok(_) => {
                return PortalState::Unavailable(String::from(
                    "The RemoteDesktop portal offers no keyboard",
                ))
            }
            Err(error) => {
                // the portal may have restarted since the proxy was made
                self.portal = None;
                return PortalState::Unavailable(error.to_string());
            }
        }
        if read_token().is_some() {
            PortalState::Ready
        } else {
            PortalState::NeedsPermission
        }
    }

    async fn ensure_session(&mut self) -> Result<(), AppError> {
        if self.session.is_some() {
            return Ok(());
        }
        let portal = self.portal().await?;
        let session = with_timeout(portal.create_session(Default::default())).await?;
        let token = read_token();
        let selected = with_timeout(
            portal.select_devices(
                &session,
                SelectDevicesOptions::default()
                    .set_devices(ashpd::enumflags2::BitFlags::from(DeviceType::Keyboard))
                    .set_persist_mode(PersistMode::ExplicitlyRevoked)
                    .set_restore_token(token.as_deref()),
            ),
        )
        .await
        .and_then(|request| request.response().map_err(portal_error));
        if let Err(error) = selected {
            let _ = session.close().await;
            return Err(error);
        }
        // the dialog, when shown, waits for the user
        let started = match tokio::time::timeout(
            PERMISSION_TIMEOUT,
            portal.start(&session, None, StartOptions::default()),
        )
        .await
        {
            Ok(result) => result
                .map_err(portal_error)
                .and_then(|request| request.response().map_err(portal_error)),
            Err(_) => Err(AppError::PermissionDenied(String::from(
                "Keyboard control was not allowed in time",
            ))),
        };
        let devices = match started {
            Ok(devices) => devices,
            Err(error) => {
                let _ = session.close().await;
                return Err(error);
            }
        };
        if let Some(token) = devices.restore_token() {
            write_token(token);
        }
        if !devices.devices().contains(DeviceType::Keyboard) {
            let _ = session.close().await;
            remove_token();
            return Err(AppError::PermissionDenied(String::from(
                "Keyboard control was not allowed",
            )));
        }
        self.session = Some(session);
        Ok(())
    }

    async fn press(&mut self, keys: &[KeyEvent]) -> Result<(), AppError> {
        let may_ask = self.session.is_none() && read_token().is_none();
        self.ensure_session().await?;
        if may_ask {
            // the permission dialog had the focus; the desktop gives it back
            // to the window that had it before
            tokio::time::sleep(DIALOG_FOCUS_SETTLE_DELAY).await;
        }
        if let Err(error) = self.send(keys).await {
            // the user or the desktop may have ended the session; a new one
            // restores the permission
            log::info!("RemoteDesktop session failed, starting a new one: {error}");
            self.close().await;
            self.ensure_session().await?;
            self.send(keys).await?;
        }
        Ok(())
    }

    async fn send(&self, keys: &[KeyEvent]) -> Result<(), AppError> {
        let (Some(portal), Some(session)) = (&self.portal, &self.session) else {
            return Err(AppError::ServiceUnavailable(String::from(
                "No RemoteDesktop session",
            )));
        };
        for &(key, pressed) in keys {
            let state = if pressed {
                KeyState::Pressed
            } else {
                KeyState::Released
            };
            with_timeout(portal.notify_keyboard_keycode(
                session,
                i32::from(key),
                state,
                Default::default(),
            ))
            .await?;
        }
        Ok(())
    }

    async fn close(&mut self) {
        if let Some(session) = self.session.take() {
            if let Err(error) = session.close().await {
                log::debug!("Could not close the RemoteDesktop session: {error}");
            }
        }
    }
}

/// The portal tells a host app by the id registered on its connection.
async fn register_app(connection: &zbus::Connection) {
    let Some(app_id) = CONFIG.get().map(|config| config.app_id.as_str()) else {
        return;
    };
    let registered = match ashpd::AppID::try_from(app_id) {
        Ok(app_id) => {
            with_timeout(ashpd::register_host_app_with_connection(
                connection.clone(),
                app_id,
            ))
            .await
        }
        Err(error) => Err(AppError::InvalidInput(error.to_string())),
    };
    if let Err(error) = registered {
        log::debug!("Could not register {app_id} with the RemoteDesktop portal: {error}");
    }
}

async fn with_timeout<T>(
    future: impl std::future::Future<Output = Result<T, ashpd::Error>>,
) -> Result<T, AppError> {
    tokio::time::timeout(CALL_TIMEOUT, future)
        .await
        .map_err(|_| {
            AppError::ServiceUnavailable(String::from(
                "The RemoteDesktop portal did not answer in time",
            ))
        })?
        .map_err(portal_error)
}

fn portal_error(error: ashpd::Error) -> AppError {
    match error {
        ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled) => {
            AppError::PermissionDenied(String::from("Keyboard control was not allowed"))
        }
        error => AppError::ServiceUnavailable(format!("RemoteDesktop portal: {error}")),
    }
}

fn token_path() -> Option<PathBuf> {
    CONFIG.get().map(|config| config.state_dir.join(TOKEN_FILE))
}

fn read_token() -> Option<String> {
    read_token_from(&token_path()?)
}

fn read_token_from(path: &Path) -> Option<String> {
    let token = std::fs::read_to_string(path).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
}

/// A token is good for a single session, so every start stores the new one.
fn write_token(token: &str) {
    let Some(path) = token_path() else {
        return;
    };
    if let Err(error) = write_token_to(&path, token) {
        log::warn!("Could not store the RemoteDesktop restore token: {error}");
    }
}

fn write_token_to(path: &Path, token: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(token.as_bytes())
}

fn remove_token() {
    if let Some(path) = token_path() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_restore_token_round_trips_through_its_file() {
        let directory =
            std::env::temp_dir().join(format!("tyco-portal-token-{}", std::process::id()));
        let path = directory.join(TOKEN_FILE);
        assert_eq!(read_token_from(&path), None);
        write_token_to(&path, "token-1").unwrap();
        assert_eq!(read_token_from(&path).as_deref(), Some("token-1"));
        write_token_to(&path, "t2").unwrap();
        assert_eq!(read_token_from(&path).as_deref(), Some("t2"));
        std::fs::write(&path, " \n").unwrap();
        assert_eq!(read_token_from(&path), None);
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn a_cancelled_dialog_is_a_denied_permission() {
        let error = portal_error(ashpd::Error::Response(
            ashpd::desktop::ResponseError::Cancelled,
        ));
        assert!(matches!(error, AppError::PermissionDenied(_)));
    }
}
