//! Native shortcut registration, suspension, conflict handling, and rollback.
use super::bindings::{HotkeyBinding, HotkeyTarget};
use super::{ApplyHotkeyResult, HotkeyApplyStatus, ProviderKind};
use crate::errors::AppError;
use crate::locks::RwLockExt;
use crate::services::selection_replace;
use std::collections::HashMap;
use std::sync::RwLock;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub(super) struct GlobalShortcutProvider;

#[derive(Default)]
pub struct HotkeyRegistry {
    pub(super) targets: RwLock<HashMap<u32, HotkeyTarget>>,
    pub(super) shortcuts: RwLock<HashMap<HotkeyTarget, Shortcut>>,
    /// Why the configured shortcut of a hotkey id could not be registered
    /// at startup, usually because another application holds it
    pub(super) failures: RwLock<HashMap<String, String>>,
}

impl HotkeyRegistry {
    pub(super) fn set_failure(&self, id: String, message: Option<String>) {
        let mut failures = self.failures.write_locked();
        match message {
            Some(message) => failures.insert(id, message),
            None => failures.remove(&id),
        };
    }
}

/// Registration effects, supplied to policy instead of an application handle.
pub(super) trait HotkeyProvider {
    fn is_registered(&self, shortcut: Shortcut) -> bool;
    fn register(&self, shortcut: Shortcut) -> Result<(), AppError>;
    fn unregister(&self, shortcut: Shortcut) -> Result<(), AppError>;
}

pub(super) struct SystemHotkeyProvider<'a>(pub(super) &'a AppHandle);

impl HotkeyProvider for SystemHotkeyProvider<'_> {
    fn is_registered(&self, shortcut: Shortcut) -> bool {
        self.0.global_shortcut().is_registered(shortcut)
    }
    fn register(&self, shortcut: Shortcut) -> Result<(), AppError> {
        self.0
            .global_shortcut()
            .register(shortcut)
            .map_err(|error| AppError::Message(error.to_string()))
    }
    fn unregister(&self, shortcut: Shortcut) -> Result<(), AppError> {
        self.0
            .global_shortcut()
            .unregister(shortcut)
            .map_err(|error| AppError::Message(error.to_string()))
    }
}

pub(super) fn suspend_with(
    kind: ProviderKind,
    registry: &HotkeyRegistry,
    provider: &impl HotkeyProvider,
    suspended: bool,
) {
    if kind != ProviderKind::GlobalShortcut {
        return;
    }
    let shortcuts = registry
        .shortcuts
        .read_locked()
        .values()
        .copied()
        .collect::<Vec<_>>();
    for shortcut in shortcuts {
        let registered = provider.is_registered(shortcut);
        let result = if suspended && registered {
            provider.unregister(shortcut)
        } else if !suspended && !registered {
            provider.register(shortcut)
        } else {
            Ok(())
        };
        if let Err(error) = result {
            log::warn!(
                "Could not {} a hotkey: {error}",
                if suspended { "suspend" } else { "resume" }
            );
        }
    }
}

pub(super) fn apply_global_shortcut(
    app: &AppHandle,
    target: &HotkeyTarget,
    shortcut: Option<Shortcut>,
) -> Result<ApplyHotkeyResult, AppError> {
    apply_global_shortcut_with(
        &app.state::<HotkeyRegistry>(),
        &SystemHotkeyProvider(app),
        target,
        shortcut,
    )
}

fn apply_global_shortcut_with(
    registry: &HotkeyRegistry,
    provider: &impl HotkeyProvider,
    target: &HotkeyTarget,
    shortcut: Option<Shortcut>,
) -> Result<ApplyHotkeyResult, AppError> {
    let ready = ApplyHotkeyResult {
        status: HotkeyApplyStatus::Ready,
        external_command: None,
        message: None,
    };
    let previous = registry.shortcuts.read_locked().get(target).copied();

    if previous == shortcut {
        return Ok(ready);
    }
    if let Some(previous) = previous {
        // a shortcut suspended while the settings record is not registered
        if provider.is_registered(previous) {
            provider
                .unregister(previous)
                .map_err(|error| AppError::Message(error.to_string()))?;
        }
        registry.targets.write_locked().remove(&previous.id());
    }
    let Some(shortcut) = shortcut else {
        registry.shortcuts.write_locked().remove(target);
        return Ok(ready);
    };
    if let Err(error) = provider.register(shortcut) {
        if let Some(previous) = previous {
            match provider.register(previous) {
                Ok(()) => {
                    registry
                        .targets
                        .write_locked()
                        .insert(previous.id(), target.clone());
                }
                Err(restore_error) => {
                    // the target has no shortcut at all now; the registry
                    // must not claim the old one is still bound
                    log::error!("Could not restore the previous shortcut: {restore_error}");
                    registry.shortcuts.write_locked().remove(target);
                }
            }
        }
        return Ok(ApplyHotkeyResult {
            status: HotkeyApplyStatus::Conflict,
            external_command: None,
            message: Some(error.to_string()),
        });
    }

    registry
        .targets
        .write_locked()
        .insert(shortcut.id(), target.clone());
    registry
        .shortcuts
        .write_locked()
        .insert(target.clone(), shortcut);
    Ok(ready)
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
                        .read_locked()
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
                        .write_locked()
                        .insert(shortcut.id(), binding.target.clone());
                    registry
                        .shortcuts
                        .write_locked()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::activation::ActivationMode;
    #[derive(Default)]
    struct FakeProvider {
        registered: std::cell::RefCell<std::collections::HashSet<u32>>,
        rejected: std::cell::RefCell<std::collections::HashSet<u32>>,
        unregister_fails: std::cell::Cell<bool>,
        calls: std::cell::RefCell<Vec<(bool, u32)>>,
    }

    impl HotkeyProvider for FakeProvider {
        fn is_registered(&self, shortcut: Shortcut) -> bool {
            self.registered.borrow().contains(&shortcut.id())
        }
        fn register(&self, shortcut: Shortcut) -> Result<(), AppError> {
            self.calls.borrow_mut().push((true, shortcut.id()));
            if self.rejected.borrow().contains(&shortcut.id()) {
                return Err(AppError::Message("shortcut conflict".into()));
            }
            self.registered.borrow_mut().insert(shortcut.id());
            Ok(())
        }
        fn unregister(&self, shortcut: Shortcut) -> Result<(), AppError> {
            self.calls.borrow_mut().push((false, shortcut.id()));
            if self.unregister_fails.get() {
                return Err(AppError::Message("unregister failed".into()));
            }
            self.registered.borrow_mut().remove(&shortcut.id());
            Ok(())
        }
    }

    fn shortcut_fixture() -> (
        HotkeyRegistry,
        FakeProvider,
        HotkeyTarget,
        Shortcut,
        Shortcut,
    ) {
        let registry = HotkeyRegistry::default();
        let provider = FakeProvider::default();
        let target = HotkeyTarget::Mode(ActivationMode::Write);
        let old: Shortcut = "Ctrl+Shift+W".parse().unwrap();
        let new: Shortcut = "Ctrl+Shift+E".parse().unwrap();
        registry
            .shortcuts
            .write()
            .unwrap()
            .insert(target.clone(), old);
        registry
            .targets
            .write()
            .unwrap()
            .insert(old.id(), target.clone());
        provider.registered.borrow_mut().insert(old.id());
        (registry, provider, target, old, new)
    }

    #[test]
    fn shortcut_replacement_and_unassignment_keep_registry_and_provider_in_sync() {
        let (registry, provider, target, old, new) = shortcut_fixture();
        assert_eq!(
            apply_global_shortcut_with(&registry, &provider, &target, Some(old))
                .unwrap()
                .status,
            HotkeyApplyStatus::Ready
        );
        assert!(provider.calls.borrow().is_empty());
        assert_eq!(
            apply_global_shortcut_with(&registry, &provider, &target, Some(new))
                .unwrap()
                .status,
            HotkeyApplyStatus::Ready
        );
        assert!(!provider.is_registered(old));
        assert!(provider.is_registered(new));
        assert_eq!(registry.shortcuts.read().unwrap().get(&target), Some(&new));
        assert!(!registry.targets.read().unwrap().contains_key(&old.id()));
        apply_global_shortcut_with(&registry, &provider, &target, None).unwrap();
        assert!(registry.shortcuts.read().unwrap().is_empty());
        assert!(registry.targets.read().unwrap().is_empty());
        assert!(provider.registered.borrow().is_empty());
    }

    #[test]
    fn shortcut_conflict_restores_the_previous_registration() {
        let (registry, provider, target, old, new) = shortcut_fixture();
        provider.rejected.borrow_mut().insert(new.id());
        let result = apply_global_shortcut_with(&registry, &provider, &target, Some(new)).unwrap();
        assert_eq!(result.status, HotkeyApplyStatus::Conflict);
        assert_eq!(result.message.as_deref(), Some("shortcut conflict"));
        assert_eq!(registry.shortcuts.read().unwrap().get(&target), Some(&old));
        assert_eq!(
            registry.targets.read().unwrap().get(&old.id()),
            Some(&target)
        );
        assert!(provider.is_registered(old));
        assert_eq!(
            *provider.calls.borrow(),
            [(false, old.id()), (true, new.id()), (true, old.id())]
        );
    }

    #[test]
    fn failed_rollback_removes_the_stale_registry_entry() {
        let (registry, provider, target, old, new) = shortcut_fixture();
        provider.rejected.borrow_mut().extend([old.id(), new.id()]);
        assert_eq!(
            apply_global_shortcut_with(&registry, &provider, &target, Some(new))
                .unwrap()
                .status,
            HotkeyApplyStatus::Conflict
        );
        assert!(registry.shortcuts.read().unwrap().is_empty());
        assert!(registry.targets.read().unwrap().is_empty());
        assert!(provider.registered.borrow().is_empty());
    }

    #[test]
    fn unregister_failure_keeps_the_previous_binding_and_does_not_register_a_new_one() {
        let (registry, provider, target, old, new) = shortcut_fixture();
        provider.unregister_fails.set(true);
        assert!(apply_global_shortcut_with(&registry, &provider, &target, Some(new)).is_err());
        assert_eq!(registry.shortcuts.read().unwrap().get(&target), Some(&old));
        assert_eq!(
            registry.targets.read().unwrap().get(&old.id()),
            Some(&target)
        );
        assert_eq!(*provider.calls.borrow(), [(false, old.id())]);
    }

    #[test]
    fn suspension_is_idempotent_and_does_not_touch_desktop_managed_bindings() {
        let (registry, provider, target, old, _) = shortcut_fixture();
        suspend_with(ProviderKind::Portal, &registry, &provider, true);
        suspend_with(ProviderKind::External, &registry, &provider, true);
        assert!(provider.calls.borrow().is_empty());
        suspend_with(ProviderKind::GlobalShortcut, &registry, &provider, true);
        suspend_with(ProviderKind::GlobalShortcut, &registry, &provider, true);
        assert!(!provider.is_registered(old));
        assert_eq!(registry.shortcuts.read().unwrap().get(&target), Some(&old));
        suspend_with(ProviderKind::GlobalShortcut, &registry, &provider, false);
        suspend_with(ProviderKind::GlobalShortcut, &registry, &provider, false);
        assert_eq!(
            *provider.calls.borrow(),
            [(false, old.id()), (true, old.id())]
        );
    }
}
