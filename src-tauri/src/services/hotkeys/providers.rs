//! Registration through native shortcuts or external compositor bindings.
#[cfg(not(target_os = "linux"))]
use super::PortalProvider;
use super::{ExternalProvider, HotkeyBinding};
use crate::errors::AppError;
use tauri::App;

impl ExternalProvider {
    pub(super) fn register(
        self,
        _app: &mut App,
        _bindings: Vec<HotkeyBinding>,
    ) -> Result<(), AppError> {
        log::info!("No in-process hotkey provider is available; use tyco-ctl or D-Bus");
        Ok(())
    }
}

#[cfg(not(target_os = "linux"))]
impl PortalProvider {
    pub(super) fn register(
        self,
        _app: &mut App,
        _bindings: Vec<HotkeyBinding>,
    ) -> Result<(), AppError> {
        Err(AppError::Message(String::from(
            "The global shortcuts portal is only available on Linux",
        )))
    }
}
