//! Native registrations commit with the configuration, or return to their previous state.
use super::bindings::restore_config_shortcut;
use super::{
    apply, bindings_from_config, HotkeyApplyRequest, HotkeyApplyStatus, HotkeyBinding,
    HotkeyRegistry, HotkeyTarget, ProviderKind, ProviderState,
};
use crate::errors::AppError;
use crate::locks::RwLockExt;
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Registers the hotkeys `next` changes and saves it. A shortcut the system
/// refuses, e.g. one another application holds, keeps its previous value in
/// the saved config and is reported as a conflict, so that the rest of the
/// settings still save.
pub fn with_config_changes<T>(
    app: &AppHandle,
    previous: &Value,
    next: &mut Value,
    save: impl FnOnce(&Value) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let kind = app.state::<ProviderState>().kind();
    let before = bindings_from_config(previous);
    let changes = binding_changes(&before, bindings_from_config(next));
    if kind != ProviderKind::GlobalShortcut {
        let result = save(next)?;
        if !changes.is_empty() {
            notify_changed(app);
            // the portal binds only the hotkeys of its session: a launcher
            // page added or removed needs a new one
            if kind == ProviderKind::Portal && targets_changed(&before, next) {
                rebind_portal_later(app);
            }
        }
        return Ok(result);
    }
    let registry = app.state::<HotkeyRegistry>();
    let changes = changes
        .into_iter()
        .map(|(target, shortcut)| {
            let previous = registry
                .shortcuts
                .read_locked()
                .get(&target)
                .map(ToString::to_string)
                .unwrap_or_default();
            (target, previous, shortcut.unwrap_or_default())
        })
        .collect::<Vec<_>>();
    let result = transact(
        &changes,
        |target, shortcut| {
            let result = apply(
                app,
                HotkeyApplyRequest {
                    mode: target.id(),
                    shortcut: shortcut.into(),
                },
            )?;
            if result.status == HotkeyApplyStatus::Conflict {
                let message = result.message.unwrap_or_else(|| "Shortcut conflict".into());
                registry.set_failure(target.id(), Some(message));
                return Ok(Applied::Conflict);
            }
            Ok(Applied::Ready)
        },
        |refused| {
            for target in refused {
                restore_config_shortcut(next, previous, target);
            }
            save(next)
        },
    );
    if result.is_ok() {
        retry_failed(app, next, &changes);
    }
    if !changes.is_empty() {
        notify_changed(app);
    }
    result
}

/// Hotkeys that could not be registered at startup get another chance with
/// every save: the application holding them may have quit since.
fn retry_failed(app: &AppHandle, config: &Value, changes: &[(HotkeyTarget, String, String)]) {
    let registry = app.state::<HotkeyRegistry>();
    let failed = registry
        .failures
        .read_locked()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    for binding in bindings_from_config(config) {
        let id = binding.target.id();
        let Some(shortcut) = binding.shortcut else {
            continue;
        };
        if !failed.contains(&id) || changes.iter().any(|(target, ..)| *target == binding.target) {
            continue;
        }
        match apply(
            app,
            HotkeyApplyRequest {
                mode: id.clone(),
                shortcut,
            },
        ) {
            Ok(result) if result.status == HotkeyApplyStatus::Conflict => {
                registry.set_failure(id, result.message);
            }
            Ok(_) => {}
            Err(error) => log::debug!("Hotkey {id} is still unavailable: {error}"),
        }
    }
}

fn targets_changed(before: &[HotkeyBinding], next: &Value) -> bool {
    let after = bindings_from_config(next);
    before.len() != after.len()
        || before
            .iter()
            .any(|old| !after.iter().any(|binding| binding.target == old.target))
}

fn rebind_portal_later(app: &AppHandle) {
    let handle = app.clone();
    let spawned = app
        .state::<crate::services::background::BackgroundServices>()
        .spawn_async(async move {
            if let Err(error) = super::rebind(&handle).await {
                log::warn!("Could not bind the changed hotkeys: {error}");
            }
        });
    if let Err(error) = spawned {
        log::warn!("Could not bind the changed hotkeys: {error}");
    }
}

fn notify_changed(app: &AppHandle) {
    if let Err(error) = crate::events::emit::<crate::events::HotkeysChanged, _>(app, ()) {
        log::warn!("Could not publish hotkey changes: {error}");
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Applied {
    Ready,
    Conflict,
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

/// Applies every change and saves; `save` gets the refused targets, to keep
/// their previous shortcuts. When applying or saving fails, the changes
/// applied so far are undone.
fn transact<T, Target>(
    changes: &[(Target, String, String)],
    apply: impl Fn(&Target, &str) -> Result<Applied, AppError>,
    save: impl FnOnce(Vec<&Target>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut applied = Vec::new();
    let result = (|| {
        let mut refused = Vec::new();
        for (target, previous, next) in changes {
            match apply(target, next)? {
                Applied::Ready => applied.push((target, previous)),
                Applied::Conflict => refused.push(target),
            }
        }
        save(refused)
    })();
    if let Err(error) = result {
        let mut rollback_errors = Vec::new();
        for (target, previous) in applied.into_iter().rev() {
            if let Err(rollback) = apply(target, previous) {
                rollback_errors.push(rollback.to_string());
            }
        }
        if !rollback_errors.is_empty() {
            return Err(AppError::Failed(format!(
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

    type Change = (String, String, String);

    #[test]
    fn failed_storage_restores_all_native_shortcuts_in_reverse_order() {
        let calls = RefCell::new(Vec::new());
        let changes: Vec<Change> = vec![
            ("quickInput".into(), "old-write".into(), "new-write".into()),
            ("chat".into(), "old-chat".into(), "new-chat".into()),
        ];
        let result: Result<(), _> = transact(
            &changes,
            |mode, shortcut| {
                calls
                    .borrow_mut()
                    .push((mode.clone(), shortcut.to_string()));
                Ok(Applied::Ready)
            },
            |refused| {
                assert!(refused.is_empty());
                Err(AppError::Failed("Disk unavailable".into()))
            },
        );
        assert!(result.is_err());
        assert_eq!(
            *calls.borrow(),
            vec![
                ("quickInput".into(), "new-write".into()),
                ("chat".into(), "new-chat".into()),
                ("chat".into(), "old-chat".into()),
                ("quickInput".into(), "old-write".into())
            ]
        );
    }

    #[test]
    fn a_conflict_keeps_the_previous_shortcut_and_still_saves() {
        let refused = RefCell::new(Vec::new());
        let changes: Vec<Change> = vec![
            ("quickInput".into(), "old".into(), "new".into()),
            ("chat".into(), "old-chat".into(), "conflict".into()),
        ];
        let result = transact(
            &changes,
            |_, shortcut| {
                Ok(if shortcut == "conflict" {
                    Applied::Conflict
                } else {
                    Applied::Ready
                })
            },
            |targets| {
                refused.borrow_mut().extend(targets.into_iter().cloned());
                Ok(7)
            },
        );
        assert_eq!(result.unwrap(), 7);
        assert_eq!(*refused.borrow(), vec![String::from("chat")]);
    }

    #[test]
    fn a_failed_registration_restores_earlier_changes_without_saving() {
        let calls = RefCell::new(Vec::new());
        let changes: Vec<Change> = vec![
            ("quickInput".into(), "old".into(), "new".into()),
            ("chat".into(), "old-chat".into(), "broken".into()),
        ];
        let result: Result<(), _> = transact(
            &changes,
            |mode, shortcut| {
                calls
                    .borrow_mut()
                    .push((mode.clone(), shortcut.to_string()));
                if shortcut == "broken" {
                    Err(AppError::Failed("Unavailable".into()))
                } else {
                    Ok(Applied::Ready)
                }
            },
            |_| panic!("A failed registration must not save"),
        );
        assert!(result.is_err());
        assert_eq!(
            calls.borrow().last(),
            Some(&("quickInput".into(), "old".into()))
        );
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
        let changes: Vec<Change> = vec![("quickInput".into(), "old".into(), "new".into())];
        let result = transact(
            &changes,
            |_, shortcut| {
                calls.borrow_mut().push(shortcut.to_string());
                Ok(Applied::Ready)
            },
            |_| Ok(42),
        );
        assert_eq!(result.unwrap(), 42);
        assert_eq!(*calls.borrow(), vec!["new"]);
    }
}
