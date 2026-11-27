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
    #[cfg(target_os = "windows")]
    identifier: String,
}

impl NotificationService {
    pub fn for_app(_identifier: &str) -> Self {
        Self {
            #[cfg(target_os = "linux")]
            sender: PersistentSender::default(),
            #[cfg(target_os = "windows")]
            identifier: _identifier.to_owned(),
        }
    }

    #[cfg(target_os = "linux")]
    pub fn notify(&self, summary: &str, body: &str) -> Result<(), AppError> {
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
                let hints = HashMap::from([("desktop-entry", Value::from("com.tyco.app"))]);
                connection
                    .call_method(
                        Some("org.freedesktop.Notifications"),
                        "/org/freedesktop/Notifications",
                        Some("org.freedesktop.Notifications"),
                        "Notify",
                        &(
                            "Tyco",
                            0u32,
                            "com.tyco.app",
                            summary,
                            body,
                            Vec::<&str>::new(),
                            hints,
                            -1i32,
                        ),
                    )
                    .map_err(|error| {
                        AppError::Failed(format!("Could not show a notification: {error}"))
                    })?;
                Ok(())
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

/// The shell balloon also works for unpackaged development binaries without
/// an AUMID registered by an installer.
#[cfg(target_os = "windows")]
pub(crate) fn notify_quiet_run(
    app: &tauri::AppHandle,
    title: &str,
    text: &str,
) -> Result<(), AppError> {
    use std::sync::atomic::{AtomicU32, Ordering};
    use tauri::Manager;
    use windows_sys::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_ICON, NIF_INFO, NIIF_INFO, NIIF_RESPECT_QUIET_TIME, NIM_ADD,
        NIM_DELETE, NIM_MODIFY, NOTIFYICONDATAW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{LoadIconW, IDI_APPLICATION};

    if !cfg!(debug_assertions) {
        match app
            .state::<std::sync::Arc<NotificationService>>()
            .notify(title, text)
        {
            Ok(()) => return Ok(()),
            Err(error) => {
                log::debug!("Windows toast unavailable, using the shell notification area: {error}")
            }
        }
    }

    static NEXT_ICON: AtomicU32 = AtomicU32::new(1);
    let id = NEXT_ICON.fetch_add(1, Ordering::Relaxed);
    let window = app
        .get_webview_window(crate::services::runtime::MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::ServiceUnavailable("Main window is unavailable".into()))?;
    let hwnd = window.hwnd()?.0;
    let mut icon = NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: hwnd,
        uID: id,
        uFlags: NIF_ICON,
        // A shared system icon is owned by Windows.
        hIcon: unsafe { LoadIconW(std::ptr::null_mut(), IDI_APPLICATION) },
        ..Default::default()
    };
    if unsafe { Shell_NotifyIconW(NIM_ADD, &icon) } == 0 {
        return Err(AppError::Failed(
            "Could not register the shell notification".into(),
        ));
    }
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
    icon.szInfoTitle = notification_text(title);
    icon.szInfo = notification_text(text);
    icon.uFlags = NIF_INFO;
    icon.dwInfoFlags = NIIF_INFO | NIIF_RESPECT_QUIET_TIME;
    if unsafe { Shell_NotifyIconW(NIM_MODIFY, &icon) } == 0 {
        unsafe { Shell_NotifyIconW(NIM_DELETE, &icon) };
        return Err(AppError::Failed(
            "Could not show the shell notification".into(),
        ));
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(12)).await;
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(hwnd) = handle
                .get_webview_window(crate::services::runtime::MAIN_WINDOW_LABEL)
                .and_then(|window| window.hwnd().ok())
            {
                let icon = NOTIFYICONDATAW {
                    cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
                    hWnd: hwnd.0,
                    uID: id,
                    ..Default::default()
                };
                unsafe { Shell_NotifyIconW(NIM_DELETE, &icon) };
            }
        });
    });
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
