//! A small status bubble near the bottom of the screen for work that runs
//! without a Tyco window, such as replacing the selection. It never takes the
//! keyboard and lets clicks through, so the focused window keeps working.
//! It is a plain GTK window rather than a webview: it has to appear at once
//! and costs nothing while hidden.

use serde::Deserialize;
use tauri::AppHandle;

use crate::errors::AppError;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum StatusOverlayKind {
    Pending,
    Success,
    Info,
    Error,
}

#[derive(Clone, Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct StatusOverlayRequest {
    pub(crate) kind: StatusOverlayKind,
    pub(crate) text: String,
    /// Shows a hidden bubble only after this delay, so quick work finishes
    /// without anything flashing on the screen.
    #[serde(default)]
    #[ts(as = "Option<u64>", optional)]
    pub(crate) delay_ms: u64,
    #[serde(default)]
    pub(crate) hide_after_ms: Option<u64>,
    /// Updates a visible bubble, but neither shows a hidden one nor lets a
    /// pending delay run out.
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    pub(crate) only_if_visible: bool,
}

/// Shows the bubble as `request` says, or hides it for `None`. A request
/// replaces the previous one together with its timers.
pub fn update(app: &AppHandle, request: Option<StatusOverlayRequest>) -> Result<(), AppError> {
    app.run_on_main_thread(move || crate::services::platform::update_status_overlay(request))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_overlay_requests_with_defaults() {
        let json = serde_json::json!({
            "kind": "success",
            "text": "Done"
        });
        let req: StatusOverlayRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.kind, StatusOverlayKind::Success);
        assert_eq!(req.text, "Done");
        assert_eq!(req.delay_ms, 0);
        assert_eq!(req.hide_after_ms, None);
        assert!(!req.only_if_visible);
    }

    #[test]
    fn deserializes_overlay_kinds() {
        for (name, expected) in [
            ("pending", StatusOverlayKind::Pending),
            ("success", StatusOverlayKind::Success),
            ("info", StatusOverlayKind::Info),
            ("error", StatusOverlayKind::Error),
        ] {
            let parsed: StatusOverlayKind =
                serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(parsed, expected);
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) mod quiet {
    use super::*;
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    use tauri::Manager;

    use crate::services::platform::linux::status_overlay;

    struct Notice {
        kind: StatusOverlayKind,
        text: String,
        expires_at: Option<Instant>,
        was_focused: bool,
    }

    const START_NOTICE_DURATION: Duration = Duration::from_millis(3500);

    static HAS_TRAY_HOST: AtomicBool = AtomicBool::new(true);

    /// A missing StatusNotifier host is common on GNOME. Ignore an
    /// inconclusive probe so other tray implementations keep short notices.
    pub(crate) fn probe_tray_host(app: &AppHandle) {
        use crate::services::background::BackgroundServices;
        let _ = app
            .state::<BackgroundServices>()
            .spawn_thread("quiet-run-tray-probe", |_| {
                use crate::services::platform::session::{current, Desktop};
                if current().desktop != Desktop::Gnome {
                    return;
                }
                let connection = zbus::blocking::connection::Builder::session()
                    .and_then(|builder| builder.method_timeout(Duration::from_secs(1)).build());
                if let Ok(connection) = connection {
                    let host = zbus::blocking::Proxy::new(
                        &connection,
                        "org.kde.StatusNotifierWatcher",
                        "/StatusNotifierWatcher",
                        "org.kde.StatusNotifierWatcher",
                    )
                    .and_then(|proxy| proxy.get_property::<bool>("IsStatusNotifierHostRegistered"));
                    HAS_TRAY_HOST.store(host.unwrap_or(false), Ordering::Relaxed);
                }
            });
    }

    thread_local! {
        static PENDING: RefCell<Option<Notice>> = const { RefCell::new(None) };
        static COMPLETIONS: RefCell<std::collections::VecDeque<Notice>> = const { RefCell::new(std::collections::VecDeque::new()) };
        static TIMER: RefCell<Option<gtk::glib::SourceId>> = const { RefCell::new(None) };
    }

    pub(crate) fn show(app: &AppHandle, kind: StatusOverlayKind, text: String, is_claimed: bool) {
        let has_tray =
            app.tray_by_id("main-tray").is_some() && HAS_TRAY_HOST.load(Ordering::Relaxed);
        if !status_overlay::can_show() && kind == StatusOverlayKind::Pending {
            if !has_tray && is_claimed && !focused(app) {
                notify(app, vec![text]);
            }
            return;
        }
        let mut notice = Notice {
            kind,
            text,
            expires_at: None,
            was_focused: false,
        };
        if kind == StatusOverlayKind::Pending {
            PENDING.with(|pending| {
                let mut pending = pending.borrow_mut();
                if is_claimed {
                    if let Some(pending) = pending.as_mut() {
                        pending.text = notice.text;
                        return;
                    }
                }
                notice.expires_at = has_tray.then(|| Instant::now() + START_NOTICE_DURATION);
                *pending = Some(notice);
            });
        } else {
            COMPLETIONS.with(|queue| {
                let mut queue = queue.borrow_mut();
                // Keep notifications bounded while a TyCo window has the focus.
                if queue.len() >= 16 {
                    queue.pop_front();
                }
                queue.push_back(notice);
            });
        }
        refresh(app);
    }

    pub(crate) fn clear_pending(app: &AppHandle) {
        PENDING.with(|pending| pending.borrow_mut().take());
        refresh(app);
    }

    fn focused(app: &AppHandle) -> bool {
        app.webview_windows()
            .values()
            .any(|window| window.is_focused().unwrap_or(false))
    }

    fn notify(app: &AppHandle, messages: Vec<String>) {
        if messages.is_empty() {
            return;
        }
        let service = app
            .state::<std::sync::Arc<crate::services::platform::notifications::NotificationService>>(
            );
        let service = std::sync::Arc::clone(&service);
        let _ = app
            .state::<crate::services::background::BackgroundServices>()
            .spawn_thread("quiet-run-notice", move |_| {
                for message in messages {
                    if let Err(error) = service.notify(&message, "") {
                        log::warn!("Could not show quiet run notification: {error}");
                    }
                }
            });
    }

    pub(crate) fn refresh(app: &AppHandle) {
        let focused = focused(app);
        if !status_overlay::can_show() {
            if !focused {
                let messages = COMPLETIONS.with(|queue| {
                    queue
                        .borrow_mut()
                        .drain(..)
                        .map(|notice| notice.text)
                        .collect()
                });
                notify(app, messages);
            }
            return;
        }
        TIMER.with(|timer| {
            if let Some(timer) = timer.borrow_mut().take() {
                timer.remove();
            }
        });
        let now = Instant::now();
        let pending = PENDING.with(|pending| {
            let mut pending = pending.borrow_mut();
            let notice = pending.as_mut()?;
            if notice.expires_at.is_some() && notice.was_focused && !focused {
                notice.expires_at = Some(now + START_NOTICE_DURATION);
            }
            notice.was_focused = focused;
            (!focused).then(|| request_for(notice, now)).flatten()
        });
        let completion =
            COMPLETIONS.with(|queue| completion_request(&mut queue.borrow_mut(), focused, now));
        let request = completion.or(pending);
        if let Some(delay) = request.as_ref().and_then(|request| request.hide_after_ms) {
            let app = app.clone();
            let timer =
                gtk::glib::timeout_add_local_once(Duration::from_millis(delay), move || {
                    TIMER.with(|timer| timer.borrow_mut().take());
                    refresh(&app);
                });
            TIMER.with(|slot| *slot.borrow_mut() = Some(timer));
        }
        status_overlay::update_quiet(request);
    }

    fn completion_request(
        queue: &mut std::collections::VecDeque<Notice>,
        focused: bool,
        now: Instant,
    ) -> Option<StatusOverlayRequest> {
        while queue
            .front()
            .is_some_and(|notice| notice.expires_at.is_some_and(|deadline| deadline <= now))
        {
            queue.pop_front();
        }
        if focused {
            return None;
        }
        let notice = queue.front_mut()?;
        let duration = if notice.kind == StatusOverlayKind::Error {
            8
        } else {
            4
        };
        notice
            .expires_at
            .get_or_insert(now + Duration::from_secs(duration));
        request_for(notice, now)
    }

    fn request_for(notice: &Notice, now: Instant) -> Option<StatusOverlayRequest> {
        let remaining = notice
            .expires_at
            .map(|deadline| deadline.saturating_duration_since(now));
        if remaining.is_some_and(|remaining| remaining.is_zero()) {
            return None;
        }
        Some(StatusOverlayRequest {
            kind: notice.kind,
            text: notice.text.clone(),
            delay_ms: 0,
            hide_after_ms: remaining.map(|remaining| (remaining.as_millis() as u64).max(1)),
            only_if_visible: false,
        })
    }
    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn completion_waits_for_focus_to_leave_before_its_display_duration_begins() {
            let mut queue = std::collections::VecDeque::from([Notice {
                kind: StatusOverlayKind::Error,
                text: "Failed".into(),
                expires_at: None,
                was_focused: false,
            }]);
            let first = Instant::now();
            assert!(completion_request(&mut queue, true, first).is_none());
            let later = first + Duration::from_secs(30);
            assert_eq!(
                completion_request(&mut queue, false, later)
                    .unwrap()
                    .hide_after_ms,
                Some(8000)
            );
            assert!(
                completion_request(&mut queue, false, later + Duration::from_secs(8)).is_none()
            );
            assert!(queue.is_empty());
        }
    }
}
