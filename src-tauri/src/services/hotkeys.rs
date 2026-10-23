//! Coordinates hotkey providers and exposes the application hotkey API.
use crate::locks::RwLockExt;
mod bindings;
mod config_transaction;
pub use config_transaction::with_config_changes;
mod global_shortcut;
mod status;
pub(crate) mod voice_gesture;
pub use status::{provider_info, HotkeyApplyResult, HotkeyApplyStatus, HotkeyProviderInfo};

use crate::errors::AppError;
use crate::services::platform::hotkeys::{external_command, portal, provider_kind, ProviderKind};
use crate::services::platform::session;
use crate::state::AppState;
pub use bindings::default_hotkeys_config;
pub(crate) use bindings::{bindings_from_config, global_target, HotkeyBinding, HotkeyTarget};
pub use global_shortcut::HotkeyRegistry;
use global_shortcut::{
    apply_global_shortcut, suspend_with, GlobalShortcutProvider, SystemHotkeyProvider,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::RwLock;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_global_shortcut::Shortcut;

/// The provider chosen at startup; the portal one turns `External` when the
/// desktop has no working GlobalShortcuts portal after all.
pub(crate) struct ProviderState(RwLock<ProviderKind>);

impl ProviderState {
    fn new(kind: ProviderKind) -> Self {
        Self(RwLock::new(kind))
    }

    pub(crate) fn kind(&self) -> ProviderKind {
        *self.0.read_locked()
    }

    pub(crate) fn set(&self, kind: ProviderKind) {
        *self.0.write_locked() = kind;
    }
}

/// The shortcuts the desktop actually bound through the portal, described in
/// its own words and keyed by hotkey id. The user may change them in the
/// desktop settings at any time, so Tyco's configuration does not know them.
#[derive(Default)]
pub(crate) struct PortalShortcutBindings(pub(crate) RwLock<HashMap<String, String>>);

#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyApplyRequest {
    /// The hotkey id, e.g. a mode or `selectionCorrection`.
    pub mode: String,
    pub shortcut: String,
}

/// The hotkey state, which needs neither the config nor a window.
pub fn manage_state(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    portal::manage_state(
        builder
            .manage(ProviderState::new(provider_kind(session::current())))
            .manage(HotkeyRegistry::default())
            .manage(voice_gesture::VoiceGesture::default())
            .manage(PortalShortcutBindings::default()),
    )
}

pub fn setup(app: &mut App) -> Result<(), AppError> {
    let user_config = app.state::<AppState>().user_config();
    let bindings = bindings_from_config(&user_config);

    match app.state::<ProviderState>().kind() {
        ProviderKind::Portal => portal::register(app, bindings),
        ProviderKind::GlobalShortcut => GlobalShortcutProvider.register(app, bindings),
        ProviderKind::External => {
            log::info!("No in-process hotkey provider is available; use tyco-ctl or D-Bus");
            Ok(())
        }
    }
}

/// Lets the user change the portal shortcuts: in the portal's own dialog, or
/// in the desktop settings where the portal has no dialog (version 1).
pub async fn configure(app: &AppHandle) -> Result<(), AppError> {
    if app.state::<ProviderState>().kind() != ProviderKind::Portal {
        return Err(AppError::ServiceUnavailable(String::from(
            "System hotkey configuration is unavailable",
        )));
    }

    if let Err(error) = portal::configure(app).await {
        log::info!("Portal shortcut dialog is unavailable: {error}; opening the desktop settings");
        return super::platform::open_shortcut_settings();
    }
    Ok(())
}

/// Binds the hotkeys again in a new portal session. The desktop keeps the
/// shortcuts the user chose, and brings back with their defaults the ones
/// removed in its settings, which it does not do within a session.
pub async fn rebind(app: &AppHandle) -> Result<(), AppError> {
    if app.state::<ProviderState>().kind() != ProviderKind::Portal {
        return Err(AppError::ServiceUnavailable(String::from(
            "Only desktop portal hotkeys are bound again",
        )));
    }
    portal::rebind(app).await
}

/// Takes the global shortcuts away while the settings record a new one, so
/// that pressing a bound shortcut reaches the settings instead of running it.
/// Only Tyco's own registrations can be suspended: the desktop keeps portal
/// shortcuts and compositor bindings.
/// A shortcut that cannot be suspended or resumed is logged and skipped.
pub fn set_suspended(app: &AppHandle, suspended: bool) {
    suspend_with(
        app.state::<ProviderState>().kind(),
        &app.state::<HotkeyRegistry>(),
        &SystemHotkeyProvider(app),
        suspended,
    );
}

pub fn apply(app: &AppHandle, request: HotkeyApplyRequest) -> Result<HotkeyApplyResult, AppError> {
    let target = HotkeyTarget::parse(&request.mode)?;
    // an empty shortcut unassigns the hotkey
    let requested = request.shortcut.trim();
    let shortcut = (!requested.is_empty())
        .then(|| requested.parse::<Shortcut>())
        .transpose()
        .map_err(|error| AppError::InvalidInput(format!("Invalid hotkey: {error}")))?;

    match app.state::<ProviderState>().kind() {
        ProviderKind::GlobalShortcut => {
            let result = apply_global_shortcut(app, &target, shortcut)?;
            if result.status != HotkeyApplyStatus::Conflict {
                app.state::<HotkeyRegistry>().set_failure(target.id(), None);
            }
            Ok(result)
        }
        // the desktop keeps the shortcut the user chose and ignores a new
        // preferred one, so only its settings change it
        ProviderKind::Portal => Err(AppError::ServiceUnavailable(String::from(
            "Hotkeys are managed by the desktop; change them in its settings",
        ))),
        ProviderKind::External => Ok(HotkeyApplyResult {
            status: HotkeyApplyStatus::External,
            external_command: Some(external_command(&target, shortcut.map(|_| requested))),
            message: None,
        }),
    }
}
