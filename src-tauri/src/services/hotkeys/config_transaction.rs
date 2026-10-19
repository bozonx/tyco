//! Native registrations commit with the configuration, or return to their previous state.
use super::{
    apply, bindings_from_config, ApplyHotkeyRequest, HotkeyApplyStatus, HotkeyBinding,
    HotkeyRegistry, HotkeyTarget, ProviderKind, ProviderState,
};
use crate::errors::AppError;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

pub fn with_config_changes<T>(
    app: &AppHandle,
    previous: &Value,
    next: &Value,
    save: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    if app.state::<ProviderState>().kind() != ProviderKind::GlobalShortcut {
        return save();
    }
    let registry = app.state::<HotkeyRegistry>();
    let changes = binding_changes(&bindings_from_config(previous), bindings_from_config(next))
        .into_iter()
        .map(|(target, shortcut)| {
            let previous = registry
                .shortcuts
                .read()
                .expect("hotkey shortcuts lock poisoned")
                .get(&target)
                .map(ToString::to_string)
                .unwrap_or_default();
            (target.id(), previous, shortcut.unwrap_or_default())
        })
        .collect::<Vec<_>>();
    let result = transact(
        &changes,
        |mode, shortcut| {
            let result = apply(
                app,
                ApplyHotkeyRequest {
                    mode: mode.into(),
                    shortcut: shortcut.into(),
                },
            )?;
            if result.status == HotkeyApplyStatus::Conflict {
                let message = result.message.unwrap_or_else(|| "Shortcut conflict".into());
                registry.set_failure(mode.into(), Some(message.clone()));
                return Err(AppError::InvalidInput(message));
            }
            Ok(())
        },
        save,
    );
    if !changes.is_empty() {
        if let Err(error) = app.emit(super::HOTKEYS_CHANGED_EVENT, ()) {
            log::warn!("Could not publish hotkey changes: {error}");
        }
    }
    result
}

/// The targets whose shortcut the new config changes, with the shortcut they
/// get. A target only one side has, such as a launcher page added or removed,
/// changes from or to no shortcut.
fn binding_changes(
    before: &[HotkeyBinding],
    after: Vec<HotkeyBinding>,
) -> Vec<(HotkeyTarget, Option<String>)> {
    let shortcut_before = |target: &HotkeyTarget| {
        before
            .iter()
            .find(|binding| binding.target == *target)
            .and_then(|binding| binding.shortcut.clone())
    };
    let removed = before
        .iter()
        .filter(|old| {
            old.shortcut.is_some() && !after.iter().any(|binding| binding.target == old.target)
        })
        .map(|old| (old.target.clone(), None))
        .collect::<Vec<_>>();
    after
        .into_iter()
        .filter(|binding| shortcut_before(&binding.target) != binding.shortcut)
        .map(|binding| (binding.target, binding.shortcut))
        .chain(removed)
        .collect()
}

fn transact<T>(
    changes: &[(String, String, String)],
    apply: impl Fn(&str, &str) -> Result<(), AppError>,
    save: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut applied = Vec::new();
    let result = (|| {
        for (mode, previous, next) in changes {
            apply(mode, next)?;
            applied.push((mode, previous));
        }
        save()
    })();
    if let Err(error) = result {
        let mut rollback_errors = Vec::new();
        for (mode, previous) in applied.into_iter().rev() {
            if let Err(rollback) = apply(mode, previous) {
                rollback_errors.push(rollback.to_string());
            }
        }
        if !rollback_errors.is_empty() {
            return Err(AppError::Message(format!(
                "{error}; could not restore hotkeys: {}",
                rollback_errors.join("; ")
            )));
        }
        return Err(error);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn failed_storage_restores_all_native_shortcuts_in_reverse_order() {
        let calls = RefCell::new(Vec::new());
        let changes = vec![
            ("write".into(), "old-write".into(), "new-write".into()),
            ("chat".into(), "old-chat".into(), "new-chat".into()),
        ];
        let result: Result<(), _> = transact(
            &changes,
            |mode, shortcut| {
                calls
                    .borrow_mut()
                    .push((mode.to_string(), shortcut.to_string()));
                Ok(())
            },
            || Err(AppError::Message("Disk unavailable".into())),
        );
        assert!(result.is_err());
        assert_eq!(
            *calls.borrow(),
            vec![
                ("write".into(), "new-write".into()),
                ("chat".into(), "new-chat".into()),
                ("chat".into(), "old-chat".into()),
                ("write".into(), "old-write".into())
            ]
        );
    }

    #[test]
    fn conflicting_registration_restores_earlier_changes_without_saving() {
        let calls = RefCell::new(Vec::new());
        let changes = vec![
            ("write".into(), "old".into(), "new".into()),
            ("chat".into(), "old-chat".into(), "conflict".into()),
        ];
        let result: Result<(), _> = transact(
            &changes,
            |mode, shortcut| {
                calls
                    .borrow_mut()
                    .push((mode.to_string(), shortcut.to_string()));
                if shortcut == "conflict" {
                    Err(AppError::InvalidInput("Conflict".into()))
                } else {
                    Ok(())
                }
            },
            || panic!("Conflicting registrations must not save"),
        );
        assert!(result.is_err());
        assert_eq!(calls.borrow().last(), Some(&("write".into(), "old".into())));
    }

    #[test]
    fn added_and_removed_launcher_pages_change_their_shortcuts() {
        let before = bindings_from_config(&serde_json::json!({
            "launcherPages": [
                {"id": "kept", "hotkey": "Ctrl+Alt+K"},
                {"id": "removed", "hotkey": "Ctrl+Alt+R"},
                {"id": "unbound"},
            ],
        }));
        let after = bindings_from_config(&serde_json::json!({
            "launcherPages": [
                {"id": "kept", "hotkey": "Ctrl+Alt+K"},
                {"id": "added", "hotkey": "Ctrl+Alt+A"},
            ],
        }));
        let changes = binding_changes(&before, after);
        assert_eq!(
            changes,
            vec![
                (
                    HotkeyTarget::LauncherPage("added".into()),
                    Some("Ctrl+Alt+A".into())
                ),
                (HotkeyTarget::LauncherPage("removed".into()), None),
            ]
        );
    }

    #[test]
    fn successful_storage_keeps_the_new_registration() {
        let calls = RefCell::new(Vec::new());
        let result = transact(
            &[("write".into(), "old".into(), "new".into())],
            |_, shortcut| {
                calls.borrow_mut().push(shortcut.to_string());
                Ok(())
            },
            || Ok(42),
        );
        assert_eq!(result.unwrap(), 42);
        assert_eq!(*calls.borrow(), vec!["new"]);
    }
}
