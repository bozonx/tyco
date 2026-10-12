//! Coordinates hotkey providers and exposes the application hotkey API.
mod bindings;
#[path = "hotkeys/global-shortcut.rs"]
mod global_shortcut;
mod status;
pub use status::{provider_info, ApplyHotkeyResult, HotkeyApplyStatus, HotkeyProviderInfo};

use crate::errors::AppError;
use crate::services::platform::hotkeys::{external_command, provider_kind, ProviderKind};
#[cfg(target_os = "linux")]
use crate::services::platform::linux::hotkeys_portal::{
    configure_portal, rebind_portal, PortalState,
};
use crate::services::platform::session;
use crate::state::AppState;
pub(crate) use bindings::{bindings_from_config, global_target, HotkeyBinding, HotkeyTarget};
pub use bindings::{default_hotkeys_config, default_selection_hotkeys_config};
pub use global_shortcut::HotkeyRegistry;
use global_shortcut::{
    apply_global_shortcut, suspend_with, GlobalShortcutProvider, SystemHotkeyProvider,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::RwLock;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_global_shortcut::Shortcut;

/// Emitted when the desktop reports changed portal shortcuts.
pub const HOTKEYS_CHANGED_EVENT: &str = "app://hotkeys-changed";

pub(crate) struct ProviderState(AtomicU8);

impl ProviderState {
    fn new(kind: ProviderKind) -> Self {
        Self(AtomicU8::new(kind.as_u8()))
    }

    pub(crate) fn get(&self) -> ProviderKind {
        ProviderKind::from_u8(self.0.load(Ordering::SeqCst))
    }

    pub(crate) fn set(&self, kind: ProviderKind) {
        self.0.store(kind.as_u8(), Ordering::SeqCst);
    }
}

/// The shortcuts the desktop actually bound through the portal, described in
/// its own words and keyed by hotkey id. The user may change them in the
/// desktop settings at any time, so Tyco's configuration does not know them.
#[derive(Default)]
pub(crate) struct SystemTriggers(pub(crate) RwLock<HashMap<String, String>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHotkeyRequest {
    pub mode: String,
    pub shortcut: String,
}

pub(crate) struct PortalProvider;
struct ExternalProvider;

impl ExternalProvider {
    fn register(self, _app: &mut App, _bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
        log::info!("No in-process hotkey provider is available; use tyco-ctl or D-Bus");
        Ok(())
    }
}

#[cfg(not(target_os = "linux"))]
impl PortalProvider {
    fn register(self, _app: &mut App, _bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
        Err(AppError::Message(String::from(
            "The global shortcuts portal is only available on Linux",
        )))
    }
}

pub fn setup(app: &mut App) -> Result<(), AppError> {
    let user_config = app.state::<AppState>().snapshot().settings.user_config;
    let bindings = bindings_from_config(&user_config);

    let kind = provider_kind(session::current());
    app.manage(ProviderState::new(kind));
    app.manage(HotkeyRegistry::default());
    app.manage(SystemTriggers::default());
    #[cfg(target_os = "linux")]
    app.manage(PortalState::default());

    match kind {
        ProviderKind::Portal => PortalProvider.register(app, bindings),
        ProviderKind::GlobalShortcut => GlobalShortcutProvider.register(app, bindings),
        ProviderKind::External => ExternalProvider.register(app, bindings),
    }
}

/// Lets the user change the portal shortcuts: in the portal's own dialog, or
/// in the desktop settings where the portal has no dialog (version 1).
pub async fn configure(app: &AppHandle) -> Result<(), AppError> {
    if app.state::<ProviderState>().get() != ProviderKind::Portal {
        return Err(AppError::Message(String::from(
            "System hotkey configuration is unavailable",
        )));
    }

    #[cfg(target_os = "linux")]
    if let Err(error) = configure_portal(app).await {
        log::info!("Portal shortcut dialog is unavailable: {error}; opening the desktop settings");
        return super::platform::open_shortcut_settings();
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
    Ok(())
}

/// Binds the hotkeys again in a new portal session. The desktop keeps the
/// shortcuts the user chose, and brings back with their defaults the ones
/// removed in its settings, which it does not do within a session.
pub async fn rebind(app: &AppHandle) -> Result<(), AppError> {
    if app.state::<ProviderState>().get() != ProviderKind::Portal {
        return Err(AppError::Message(String::from(
            "Only desktop portal hotkeys are bound again",
        )));
    }
    #[cfg(target_os = "linux")]
    return rebind_portal(app).await;
    #[cfg(not(target_os = "linux"))]
    Ok(())
}

/// Takes the global shortcuts away while the settings record a new one, so
/// that pressing a bound shortcut reaches the settings instead of running it.
/// Only Tyco's own registrations can be suspended: the desktop keeps portal
/// shortcuts and compositor bindings.
pub fn set_suspended(app: &AppHandle, suspended: bool) -> Result<(), AppError> {
    suspend_with(
        app.state::<ProviderState>().get(),
        &app.state::<HotkeyRegistry>(),
        &SystemHotkeyProvider(app),
        suspended,
    );
    Ok(())
}

pub fn apply(app: &AppHandle, request: ApplyHotkeyRequest) -> Result<ApplyHotkeyResult, AppError> {
    let target = HotkeyTarget::parse(&request.mode)?;
    // an empty shortcut unassigns the hotkey
    let requested = request.shortcut.trim();
    let shortcut = (!requested.is_empty())
        .then(|| requested.parse::<Shortcut>())
        .transpose()
        .map_err(|error| AppError::Message(format!("Invalid hotkey: {error}")))?;

    match app.state::<ProviderState>().get() {
        ProviderKind::GlobalShortcut => {
            let result = apply_global_shortcut(app, &target, shortcut)?;
            if result.status != HotkeyApplyStatus::Conflict {
                app.state::<HotkeyRegistry>().set_failure(target.id(), None);
            }
            Ok(result)
        }
        // the desktop keeps the shortcut the user chose and ignores a new
        // preferred one, so only its settings change it
        ProviderKind::Portal => Err(AppError::Message(String::from(
            "Hotkeys are managed by the desktop; change them in its settings",
        ))),
        ProviderKind::External => Ok(ApplyHotkeyResult {
            status: HotkeyApplyStatus::External,
            external_command: Some(external_command(&target, shortcut.map(|_| requested))),
            message: None,
        }),
    }
}
