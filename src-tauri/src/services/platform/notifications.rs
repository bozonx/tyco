//! Desktop notifications retain their sender until application shutdown.

use crate::errors::AppError;
#[cfg(any(target_os = "linux", test))]
use crate::locks::{CondvarExt, MutexExt};
use crate::services::background::StoppableService;
use std::time::Instant;

#[cfg(any(target_os = "linux", test))]
use std::sync::{Condvar, Mutex};

#[cfg(any(target_os = "linux", test))]
struct SenderState<C> {
    connection: Option<C>,
    busy: bool,
    stopped: bool,
}

/// Serializes sends without holding a lock across native calls. Shutdown
/// rejects queued sends immediately and shares the application's deadline.
#[cfg(any(target_os = "linux", test))]
struct PersistentSender<C> {
    state: Mutex<SenderState<C>>,
    changed: Condvar,
}

#[cfg(any(target_os = "linux", test))]
impl<C> Default for PersistentSender<C> {
    fn default() -> Self {
        Self {
            state: Mutex::new(SenderState {
                connection: None,
                busy: false,
                stopped: false,
            }),
            changed: Condvar::new(),
        }
    }
}

#[cfg(any(target_os = "linux", test))]
impl<C> PersistentSender<C> {
    fn send(
        &self,
        connect: impl FnOnce() -> Result<C, AppError>,
        send: impl FnOnce(&C) -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let mut state = self.state.locked();
        while state.busy && !state.stopped {
            state = self.changed.wait_locked(state);
        }
        if state.stopped {
            return Err(AppError::ServiceUnavailable(
                "Notifications are shutting down".into(),
            ));
        }
        state.busy = true;
        let cached = state.connection.take();
        drop(state);
        let connection = cached.map_or_else(connect, Ok);
        let result = connection
            .as_ref()
            .map_err(|error| AppError::ServiceUnavailable(error.to_string()))
            .and_then(send);
        let mut state = self.state.locked();
        if result.is_ok() && !state.stopped {
            state.connection = connection.ok();
        }
        state.busy = false;
        self.changed.notify_all();
        result
    }
}

#[cfg(any(target_os = "linux", test))]
impl<C> StoppableService for PersistentSender<C> {
    fn stop(&self) {
        let mut state = self.state.locked();
        state.stopped = true;
        let connection = state.connection.take();
        self.changed.notify_all();
        drop(state);
        drop(connection);
    }

    fn wait_until(&self, deadline: Instant) -> bool {
        let state = self.state.locked();
        self.changed
            .wait_while_until(state, deadline, |state| state.busy)
    }
}

#[derive(Default)]
pub struct NotificationService {
    #[cfg(target_os = "linux")]
    sender: PersistentSender<zbus::blocking::Connection>,
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    identifier: String,
}

impl NotificationService {
    pub fn for_app(_identifier: &str) -> Self {
        Self {
            #[cfg(target_os = "linux")]
            sender: PersistentSender::default(),
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            identifier: _identifier.to_owned(),
        }
    }

    #[cfg(target_os = "linux")]
    pub fn notify(&self, summary: &str, body: &str) -> Result<(), AppError> {
        self.send_linux(Some((summary, body)), &mut 0, -1)
    }

    #[cfg(target_os = "linux")]
    fn send_linux(
        &self,
        message: Option<(&str, &str)>,
        id: &mut u32,
        timeout_ms: i32,
    ) -> Result<(), AppError> {
        use std::collections::HashMap;
        use std::time::Duration;
        use zbus::zvariant::Value;

        self.sender.send(
            || {
                zbus::blocking::connection::Builder::session()
                    .and_then(|builder| builder.method_timeout(Duration::from_secs(2)).build())
                    .map_err(|error| {
                        AppError::ServiceUnavailable(format!("No session bus: {error}"))
                    })
            },
            |connection| {
                let result = if let Some((summary, body)) = message {
                    let hints =
                        HashMap::from([("desktop-entry", Value::from(self.identifier.as_str()))]);
                    connection
                        .call_method(
                            Some("org.freedesktop.Notifications"),
                            "/org/freedesktop/Notifications",
                            Some("org.freedesktop.Notifications"),
                            "Notify",
                            &(
                                "TyCo",
                                *id,
                                self.identifier.as_str(),
                                summary,
                                body,
                                Vec::<&str>::new(),
                                hints,
                                timeout_ms,
                            ),
                        )
                        .and_then(|response| {
                            *id = response.body().deserialize()?;
                            Ok(())
                        })
                } else if *id != 0 {
                    connection
                        .call_method(
                            Some("org.freedesktop.Notifications"),
                            "/org/freedesktop/Notifications",
                            Some("org.freedesktop.Notifications"),
                            "CloseNotification",
                            &(*id,),
                        )
                        .map(|_| ())
                } else {
                    Ok(())
                };
                result.map_err(|error| {
                    AppError::Failed(format!("Could not update a notification: {error}"))
                })
            },
        )
    }

    #[cfg(target_os = "windows")]
    pub fn notify(&self, summary: &str, body: &str) -> Result<(), AppError> {
        use windows::core::HSTRING;
        use windows::Data::Xml::Dom::XmlDocument;
        use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

        let notify = || -> windows::core::Result<()> {
            let document = XmlDocument::new()?;
            let escape = |text: &str| {
                text.replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
            };
            let body = if body.is_empty() {
                String::new()
            } else {
                format!("<text>{}</text>", escape(body))
            };
            document.LoadXml(&HSTRING::from(format!(
                "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text>{body}</binding></visual></toast>",
                escape(summary),
            )))?;
            let toast = ToastNotification::CreateToastNotification(&document)?;
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(&self.identifier))?
                .Show(&toast)
        };
        notify()
            .map_err(|error| AppError::Failed(format!("Could not show a notification: {error}")))
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    pub fn notify(&self, _summary: &str, _body: &str) -> Result<(), AppError> {
        Ok(())
    }
}

#[cfg(target_os = "linux")]
struct QuietNotices(std::sync::mpsc::Sender<QuietNotice>);

#[cfg(target_os = "linux")]
struct QuietNotice {
    job_id: String,
    text: Option<String>,
    finished: bool,
    created_at: Instant,
}

#[cfg(target_os = "linux")]
pub(crate) fn setup_quiet_notices(app: &tauri::AppHandle) -> Result<(), AppError> {
    use tauri::Manager;
    let (sender, receiver) = std::sync::mpsc::channel::<QuietNotice>();
    let service = app
        .state::<std::sync::Arc<NotificationService>>()
        .inner()
        .clone();
    app.state::<crate::services::background::BackgroundServices>()
        .spawn_thread("quiet-run-notices", move |stop| {
            let mut pending = None::<(String, u32)>;
            while !stop.is_stopped() {
                let notice = match receiver.recv_timeout(std::time::Duration::from_millis(200)) {
                    Ok(notice) => notice,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                };
                let mut id = pending.take().map_or(0, |(job_id, mut id)| {
                    if job_id == notice.job_id {
                        id
                    } else {
                        let _ = service.send_linux(None, &mut id, -1);
                        0
                    }
                });
                let message = (notice.created_at.elapsed() < std::time::Duration::from_secs(5))
                    .then_some(notice.text.as_deref())
                    .flatten()
                    .map(|text| (text, ""));
                let timeout = if notice.finished { -1 } else { 0 };
                if let Err(error) = service.send_linux(message, &mut id, timeout) {
                    log::warn!("Could not update quiet run notification: {error}");
                } else if !notice.finished && id != 0 {
                    pending = Some((notice.job_id, id));
                }
            }
            if let Some((_, mut id)) = pending {
                let _ = service.send_linux(None, &mut id, -1);
            }
        })?;
    app.manage(QuietNotices(sender));
    Ok(())
}

#[cfg(target_os = "linux")]
pub(crate) fn notify_quiet_run(
    app: &tauri::AppHandle,
    job_id: String,
    text: Option<String>,
    finished: bool,
) {
    use tauri::Manager;
    if let Some(notices) = app.try_state::<QuietNotices>() {
        let _ = notices.0.send(QuietNotice {
            job_id,
            text,
            finished,
            created_at: Instant::now(),
        });
    }
}

/// Uses the application's existing shell icon, including in portable builds.
#[cfg(target_os = "windows")]
pub(crate) fn notify_quiet_run(
    app: &tauri::AppHandle,
    title: &str,
    text: &str,
) -> Result<(), AppError> {
    use windows_sys::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_INFO, NIIF_INFO, NIIF_RESPECT_QUIET_TIME, NIM_MODIFY,
        NOTIFYICONDATAW,
    };

    fn notification_text<const N: usize>(value: &str) -> [u16; N] {
        let mut buffer = [0; N];
        let limit = N - 1;
        for (index, unit) in value.encode_utf16().take(limit).enumerate() {
            buffer[index] = unit;
        }
        if (0xd800..=0xdbff).contains(&buffer[limit - 1]) {
            buffer[limit - 1] = 0;
        }
        buffer
    }

    let tray = app
        .tray_by_id("main-tray")
        .ok_or_else(|| AppError::ServiceUnavailable("Tray icon is unavailable".into()))?;
    let title = notification_text(title);
    let text = notification_text(text);
    // Tauri's builder spends the first tray-icon 0.25 counter value on a
    // generated ID before applying "main-tray". Building the icon spends
    // the next value on the Windows shell ID.
    let shown = tray.with_inner_tray_icon(move |tray| {
        let icon = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: tray.window_handle(),
            uID: 2,
            uFlags: NIF_INFO,
            szInfoTitle: title,
            szInfo: text,
            dwInfoFlags: NIIF_INFO | NIIF_RESPECT_QUIET_TIME,
            ..Default::default()
        };
        unsafe { Shell_NotifyIconW(NIM_MODIFY, &icon) != 0 }
    })?;
    if !shown {
        return Err(AppError::Failed(
            "Could not show the shell notification".into(),
        ));
    }
    Ok(())
}

impl StoppableService for NotificationService {
    fn stop(&self) {
        #[cfg(target_os = "linux")]
        self.sender.stop();
    }

    fn wait_until(&self, _deadline: Instant) -> bool {
        #[cfg(target_os = "linux")]
        return self.sender.wait_until(_deadline);
        #[cfg(not(target_os = "linux"))]
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;

    struct Connection(Arc<AtomicUsize>);
    impl Drop for Connection {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn sender_survives_successful_calls_and_closes_on_shutdown() {
        let sender = PersistentSender::default();
        let closed = Arc::new(AtomicUsize::new(0));
        sender
            .send(|| Ok(Connection(closed.clone())), |_| Ok(()))
            .unwrap();
        sender
            .send(
                || panic!("A successful notification must retain its sender"),
                |_| Ok(()),
            )
            .unwrap();
        assert_eq!(closed.load(Ordering::SeqCst), 0);
        sender.stop();
        assert_eq!(closed.load(Ordering::SeqCst), 1);
        assert!(sender
            .send(|| panic!("Shutdown must reject new work"), |_| Ok(()))
            .is_err());
    }

    #[test]
    fn a_failed_send_is_not_replayed_and_the_next_request_can_reconnect() {
        let sender = PersistentSender::default();
        let closed = Arc::new(AtomicUsize::new(0));
        let result = sender.send(
            || Ok(Connection(closed.clone())),
            |_| Err(AppError::Failed("Bus disconnected".into())),
        );
        assert!(result.is_err());
        assert_eq!(closed.load(Ordering::SeqCst), 1);
        sender
            .send(|| Ok(Connection(closed.clone())), |_| Ok(()))
            .unwrap();
        assert_eq!(closed.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn stopping_an_inflight_send_is_nonblocking_and_keeps_the_deadline() {
        let sender = Arc::new(PersistentSender::default());
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let worker_sender = sender.clone();
        let worker = std::thread::spawn(move || {
            worker_sender.send(
                || Ok(()),
                |_| {
                    started_tx.send(()).unwrap();
                    finish_rx.recv().unwrap();
                    Ok(())
                },
            )
        });
        started_rx.recv().unwrap();
        sender.stop();
        assert!(!sender.wait_until(Instant::now()));
        finish_tx.send(()).unwrap();
        assert!(worker.join().unwrap().is_ok());
        assert!(sender.wait_until(Instant::now() + Duration::from_secs(1)));
    }
}
