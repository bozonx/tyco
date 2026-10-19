//! Linux GlobalShortcuts portal session lifecycle and event streams.
use crate::errors::AppError;
use crate::locks::RwLockExt;
use crate::services::hotkeys::{
    bindings_from_config, global_target, HotkeyBinding, PortalShortcutBindings, ProviderState,
    HOTKEYS_CHANGED_EVENT,
};
use crate::services::platform::hotkeys::ProviderKind;
use crate::services::selection_replace;
use crate::state::AppState;
use std::sync::RwLock;
#[cfg(target_os = "linux")]
use std::sync::{Arc, OnceLock};
use tauri::{App, AppHandle, Emitter, Manager};

#[cfg(target_os = "linux")]
use ashpd::desktop::global_shortcuts::{
    BindShortcutsOptions, ConfigureShortcutsOptions, GlobalShortcuts, ListShortcutsOptions,
    NewShortcut,
};
#[cfg(target_os = "linux")]
use ashpd::desktop::CreateSessionOptions;
#[cfg(target_os = "linux")]
use ashpd::desktop::Session;
#[cfg(target_os = "linux")]
use ashpd::{register_host_app, AppID};
#[cfg(target_os = "linux")]
use futures_util::StreamExt;
/// The portal and Tyco's session with it. Its signals are not tied to a
/// session, so binding again only replaces the session.
#[cfg(target_os = "linux")]
#[derive(Default)]
pub(crate) struct PortalState {
    portal: OnceLock<Arc<GlobalShortcuts>>,
    session: RwLock<Option<Arc<Session<GlobalShortcuts>>>>,
    /// Binding again closes the session that listing and binding use
    binding: tokio::sync::Mutex<()>,
}

#[cfg(target_os = "linux")]
impl PortalState {
    pub(crate) fn registration(
        &self,
    ) -> Option<(Arc<GlobalShortcuts>, Arc<Session<GlobalShortcuts>>)> {
        let portal = self.portal.get()?.clone();
        let session = self.session.read_locked().clone()?;
        Some((portal, session))
    }
}

#[cfg(target_os = "linux")]
pub(crate) async fn configure_portal(app: &AppHandle) -> Result<(), AppError> {
    let (portal, session) = app
        .state::<PortalState>()
        .registration()
        .ok_or_else(|| AppError::ServiceUnavailable(String::from("Hotkey portal is not ready")))?;
    portal
        .configure_shortcuts(&session, None, ConfigureShortcutsOptions::default())
        .await
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))
}

#[cfg(target_os = "linux")]
pub(crate) async fn rebind_portal(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<PortalState>();
    let _binding = state.binding.lock().await;
    let portal =
        state.portal.get().cloned().ok_or_else(|| {
            AppError::ServiceUnavailable(String::from("Hotkey portal is not ready"))
        })?;
    let previous = state.session.write_locked().take();
    // the shortcuts belong to the app, not to the session: the old session
    // goes first, so that the new one binds the same ids
    if let Some(previous) = previous {
        if let Err(error) = previous.close().await {
            log::warn!("Could not close the hotkey portal session: {error}");
        }
    }
    let bindings = bindings_from_config(&app.state::<AppState>().user_config());
    let result = bind_session(app, &portal, &bindings).await;
    if result.is_err() {
        app.state::<PortalShortcutBindings>()
            .0
            .write_locked()
            .clear();
    }
    notify_hotkeys_changed(app);
    result
}

/// Asks the desktop for the shortcuts it binds now: the user may have
/// removed them in its settings, which the portal does not report.
#[cfg(target_os = "linux")]
pub(crate) async fn refresh_system_triggers(app: &AppHandle) {
    let state = app.state::<PortalState>();
    let _binding = state.binding.lock().await;
    let Some((portal, session)) = state.registration() else {
        return;
    };
    let listed = match portal
        .list_shortcuts(&session, ListShortcutsOptions::default())
        .await
    {
        Ok(request) => request.response(),
        Err(error) => Err(error),
    };
    match listed {
        Ok(listed) => store_system_triggers(app, listed.shortcuts()),
        Err(error) => log::warn!("Could not list the portal hotkeys: {error}"),
    }
}

pub(crate) fn register(app: &mut App, bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
    let app = app.handle().clone();
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    services.spawn_async(async move {
        let app = handle;
        if let Err(error) = run_portal(app.clone(), bindings).await {
            log::warn!("GlobalShortcuts portal is unavailable: {error}; use tyco-ctl or D-Bus");
            // Wayland compositors without GlobalShortcuts must expose the
            // external binding workflow in settings instead of claiming
            // that a system confirmation is pending.
            app.state::<ProviderState>().set(ProviderKind::External);
            notify_hotkeys_changed(&app);
        }
    })
}

#[cfg(target_os = "linux")]
async fn run_portal(app: AppHandle, bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
    let app_id = AppID::try_from(app.config().identifier.as_str())
        .map_err(|error| AppError::Message(error.to_string()))?;
    if let Err(error) = register_host_app(app_id.clone()).await {
        log::warn!("Could not register host app ID {app_id} with the desktop portal: {error}");
    }

    let portal = GlobalShortcuts::new()
        .await
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))?;
    let mut activated = portal
        .receive_activated()
        .await
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))?;
    let mut deactivated = portal
        .receive_deactivated()
        .await
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))?;
    let mut changed = portal
        .receive_shortcuts_changed()
        .await
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))?;
    let portal = Arc::new(portal);
    {
        let state = app.state::<PortalState>();
        let _binding = state.binding.lock().await;
        bind_session(&app, &portal, &bindings).await?;
        let _ = state.portal.set(portal);
    }
    // the settings may already show the shortcuts the desktop had not bound
    notify_hotkeys_changed(&app);

    let watched_app = app.clone();
    app.state::<crate::services::background::BackgroundServices>()
        .spawn_async(async move {
            if let Err(error) = rebind_when_portal_restarts(&watched_app).await {
                log::warn!("Could not watch the hotkey portal for restarts: {error}");
            }
        })?;

    // selection actions press keys of their own, and wait for the hotkey
    // to be released first
    app.state::<crate::services::background::BackgroundServices>()
        .spawn_async(async move {
            while let Some(event) = deactivated.next().await {
                selection_replace::hotkey_released(event.shortcut_id());
            }
        })?;
    let changed_app = app.clone();
    app.state::<crate::services::background::BackgroundServices>()
        .spawn_async(async move {
            while let Some(event) = changed.next().await {
                store_system_triggers(&changed_app, event.shortcuts());
                notify_hotkeys_changed(&changed_app);
            }
        })?;
    while let Some(event) = activated.next().await {
        // the desktop may still keep hotkeys of older versions
        let Some(target) = global_target(event.shortcut_id()) else {
            log::warn!("Unknown portal hotkey: {}", event.shortcut_id());
            continue;
        };
        if let Err(error) = target.trigger(&app, event.shortcut_id()) {
            log::error!("Portal hotkey activation failed: {error}");
        }
    }
    log::warn!("The hotkey portal stopped reporting hotkeys");
    Ok(())
}

pub(crate) async fn shutdown(app: &AppHandle) {
    let Some(state) = app.try_state::<PortalState>() else {
        return;
    };
    let _binding = state.binding.lock().await;
    let session = state.session.write_locked().take();
    if let Some(session) = session {
        if let Err(error) = session.close().await {
            log::warn!("Could not close hotkey portal session: {error}");
        }
    }
}

/// The shortcuts live in a session of the portal service: when the service
/// restarts, after an update or a crash, the session is gone and the hotkeys
/// stop without a word. A new owner of the portal name gets them bound again.
#[cfg(target_os = "linux")]
async fn rebind_when_portal_restarts(app: &AppHandle) -> zbus::Result<()> {
    let connection = zbus::Connection::session().await?;
    let proxy = zbus::Proxy::new(
        &connection,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.GlobalShortcuts",
    )
    .await?;
    let mut owners = proxy.receive_owner_changed().await?;
    while let Some(owner) = owners.next().await {
        if owner.is_none() {
            continue;
        }
        log::info!("The desktop portal restarted; binding the hotkeys again");
        if let Err(error) = rebind_portal(app).await {
            log::warn!("Could not bind the hotkeys again: {error}");
        }
    }
    Ok(())
}

/// Opens a session, binds the hotkeys in it and keeps it. The caller holds
/// `PortalState::binding`.
#[cfg(target_os = "linux")]
async fn bind_session(
    app: &AppHandle,
    portal: &GlobalShortcuts,
    bindings: &[HotkeyBinding],
) -> Result<(), AppError> {
    let session = portal
        .create_session(CreateSessionOptions::default())
        .await
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))?;
    let shortcuts = bindings
        .iter()
        .map(|binding| {
            let trigger = binding.shortcut.as_deref().map(to_portal_trigger);
            NewShortcut::new(binding.target.id(), binding.description.as_str())
                .preferred_trigger(trigger.as_deref())
        })
        .collect::<Vec<_>>();
    let bound = portal
        .bind_shortcuts(&session, &shortcuts, None, BindShortcutsOptions::default())
        .await
        .and_then(|request| request.response())
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))?;
    store_system_triggers(app, bound.shortcuts());
    app.state::<PortalState>()
        .session
        .write_locked()
        .replace(Arc::new(session));
    Ok(())
}

#[cfg(target_os = "linux")]
pub(crate) fn notify_hotkeys_changed(app: &AppHandle) {
    if let Err(error) = app.emit(HOTKEYS_CHANGED_EVENT, ()) {
        log::warn!("Could not report changed hotkeys: {error}");
    }
}

#[cfg(target_os = "linux")]
fn store_system_triggers(
    app: &AppHandle,
    shortcuts: &[ashpd::desktop::global_shortcuts::Shortcut],
) {
    let state = app.state::<PortalShortcutBindings>();
    let mut triggers = state.0.write_locked();
    triggers.clear();
    triggers.extend(shortcuts.iter().map(|shortcut| {
        (
            shortcut.id().to_owned(),
            shortcut.trigger_description().to_owned(),
        )
    }));
}

/// The portal shortcuts can be changed in the portal's own dialog (version
/// 2) or in the settings of a desktop Tyco knows.
#[cfg(target_os = "linux")]
pub(crate) fn can_configure_portal(app: &AppHandle) -> bool {
    let has_dialog = app
        .state::<PortalState>()
        .portal
        .get()
        .is_some_and(|portal| portal.version() >= 2);
    has_dialog || crate::services::platform::has_shortcut_settings()
}

fn to_portal_trigger(shortcut: &str) -> String {
    let mut parts = shortcut.split('+').collect::<Vec<_>>();
    let key = parts.pop().unwrap_or_default();
    let modifiers = parts
        .into_iter()
        .map(|modifier| match modifier.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "CTRL+",
            "alt" => "ALT+",
            "shift" => "SHIFT+",
            "super" | "meta" | "cmd" | "command" => "LOGO+",
            _ => "",
        })
        .collect::<String>();
    let key = match key.to_ascii_lowercase().as_str() {
        "comma" => "comma".to_owned(),
        value => value.to_owned(),
    };
    format!("{modifiers}{key}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_shortcuts_to_xdg_trigger_syntax() {
        assert_eq!(to_portal_trigger("Ctrl+Alt+E"), "CTRL+ALT+e");
        assert_eq!(to_portal_trigger("Super+Shift+Comma"), "LOGO+SHIFT+comma");
    }
}
