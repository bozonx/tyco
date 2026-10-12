//! Registration through native shortcuts or external compositor bindings.
#[cfg(not(target_os = "linux"))]
use super::PortalProvider;
use super::{
    ExternalProvider, GlobalShortcutProvider, HotkeyBinding, HotkeyProvider, HotkeyRegistry,
    SystemHotkeyProvider,
};
use crate::errors::AppError;
use crate::services::selection_replace;
use tauri::{App, Manager};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

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

impl GlobalShortcutProvider {
    pub(super) fn register(
        self,
        app: &mut App,
        bindings: Vec<HotkeyBinding>,
    ) -> Result<(), AppError> {
        app.handle().plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    let hotkey_id = shortcut.id().to_string();
                    if event.state == ShortcutState::Released {
                        selection_replace::hotkey_released(&hotkey_id);
                        return;
                    }
                    let target = app
                        .state::<HotkeyRegistry>()
                        .targets
                        .read()
                        .expect("hotkey bindings lock poisoned")
                        .get(&shortcut.id())
                        .cloned();
                    if let Some(target) = target {
                        if let Err(error) = target.trigger(app, &hotkey_id) {
                            log::error!("Hotkey activation failed: {error}");
                        }
                    }
                })
                .build(),
        )?;

        let registry = app.state::<HotkeyRegistry>();
        for binding in bindings {
            let Some(shortcut) = binding.shortcut else {
                continue;
            };
            let shortcut = match shortcut.parse::<Shortcut>() {
                Ok(shortcut) => shortcut,
                Err(error) => {
                    log::warn!("Invalid hotkey for {}: {error}", binding.target.id());
                    registry.set_failure(binding.target.id(), Some(error.to_string()));
                    continue;
                }
            };
            match SystemHotkeyProvider(app.handle()).register(shortcut) {
                Ok(()) => {
                    registry
                        .targets
                        .write()
                        .expect("hotkey bindings lock poisoned")
                        .insert(shortcut.id(), binding.target.clone());
                    registry
                        .shortcuts
                        .write()
                        .expect("hotkey shortcuts lock poisoned")
                        .insert(binding.target, shortcut);
                }
                Err(error) => {
                    log::warn!(
                        "Could not register hotkey for {}: {error}",
                        binding.target.id()
                    );
                    registry.set_failure(binding.target.id(), Some(error.to_string()));
                }
            }
        }
        Ok(())
    }
}
