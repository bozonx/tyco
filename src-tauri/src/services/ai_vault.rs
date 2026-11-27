#[cfg(test)]
mod tests;

pub mod config_refs;
pub mod marker;
pub mod memory;
pub mod operations;
pub mod settings;
pub mod transfer;
pub mod types;

pub use marker::Vault;
pub use memory::*;
pub use operations::*;
pub use settings::{VaultChatHistory, VaultHistoryStorage};
pub use transfer::MovedEntity;
pub use types::*;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::errors::AppError;

mod locking;
mod registry;
pub use registry::*;

/// The folder of the main vault inside the user data folder.
pub const VAULT_DIR_NAME: &str = "ai-vault";

/// Separates the vault from the id in a reference `[vaultId:]id` the webview
/// uses for a profile or a project: ids never hold it.
pub const REF_SEPARATOR: char = ':';

/// The vault and the id of a reference; an empty vault is the main one.
pub fn split_ref(key: &str) -> (&str, &str) {
    key.split_once(REF_SEPARATOR).unwrap_or(("", key))
}

/// The reference of `id` in the vault `vault_id`, empty for the main one.
pub fn join_ref(vault_id: &str, id: &str) -> String {
    if vault_id.is_empty() {
        id.to_owned()
    } else {
        format!("{vault_id}{REF_SEPARATOR}{id}")
    }
}

/// The main vault of the app: always `ai-vault` inside the user data folder,
/// moved only with it.
pub fn main_vault(app: &AppHandle) -> Result<Vault, AppError> {
    let user_dir = crate::services::storage::user_data::user_dir_for(
        app,
        crate::services::storage::UserDirAccess::Read,
    )
    .map_err(|_| AppError::UserDataUnavailable("The data folder is not connected".into()))?;
    marker::open_default(&user_dir.join(VAULT_DIR_NAME))
}

/// The vault a reference names: empty for the main one, else one this
/// device attached. A vault not attached, or not there now, is an error;
/// nothing is made in its place.
pub fn resolve_vault(app: &AppHandle, vault_id: &str) -> Result<Vault, AppError> {
    let config = app.state::<crate::state::AppState>().user_config();
    resolve_vault_in(
        main_vault(app),
        &crate::models::user_config::attached_vaults(&config),
        vault_id,
    )
}

/// [`resolve_vault`] over the main vault as it opened and the vaults this
/// device attached.
pub fn resolve_vault_in(
    main: Result<Vault, AppError>,
    attached: &[crate::models::user_config::AttachedVault],
    vault_id: &str,
) -> Result<Vault, AppError> {
    if vault_id.is_empty() {
        return main;
    }
    // the main vault named by its own id, e.g. in a reference written by hand
    if let Ok(main) = main {
        if main.id == vault_id {
            return Ok(main);
        }
    }
    let attached = attached
        .iter()
        .find(|vault| vault.vault_id == vault_id)
        .ok_or_else(|| {
            AppError::VaultUnavailable(format!(
                "The workspace {vault_id} is not attached on this device"
            ))
        })?;
    let vault = marker::open_attached(std::path::Path::new(&attached.path))?;
    if vault.id != vault_id {
        return Err(AppError::VaultUnavailable(format!(
            "The folder {} holds another workspace now",
            attached.path
        )));
    }
    Ok(vault)
}

/// The vault part of the references to `vault`, reached by `vault_id`: empty
/// for the main vault, also when it is named by its own id.
pub fn canonical_vault_ref(app: &AppHandle, vault_id: &str, vault: &Vault) -> String {
    if vault_id.is_empty() || main_vault(app).is_ok_and(|main| main.id == vault.id) {
        String::new()
    } else {
        vault_id.to_owned()
    }
}

/// Runs `operation` on the root of the vault `vault_id` (empty: the main one);
/// access is held until all I/O using the path has completed.
pub fn with_vault<T>(
    app: &AppHandle,
    vault_id: &str,
    operation: impl FnOnce(&std::path::Path) -> Result<T, AppError>,
) -> Result<T, AppError> {
    with_vault_of(app, vault_id, |vault| operation(&vault.root))
}

/// [`with_vault`] with the vault and its id.
pub fn with_vault_of<T>(
    app: &AppHandle,
    vault_id: &str,
    operation: impl FnOnce(&Vault) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<crate::state::AppState>();
    let _access = state.read_vault();
    let vault = resolve_vault(app, vault_id)?;
    let lock = locking::vault_lock(&vault.root);
    use crate::locks::MutexExt;
    let _io = lock.locked();
    operation(&vault)
}

/// [`with_vault`] with the folders the external projects of the vault have
/// on this device.
pub fn with_projects<T>(
    app: &AppHandle,
    vault_id: &str,
    operation: impl FnOnce(&std::path::Path, &ProjectPaths) -> Result<T, AppError>,
) -> Result<T, AppError> {
    with_vault_of(app, vault_id, |vault| {
        let device = app.state::<crate::services::storage::device::DeviceStore>();
        operation(
            &vault.root,
            &ProjectPaths {
                device: &device,
                vault_id: &vault.id,
                protected_roots: protected_roots(app),
            },
        )
    })
}

/// [`with_projects`] for work that may take long, such as a file tool
/// searching a large project: `load` runs under the lock of the vault,
/// `then` only with the vault access held, so that it holds up no other
/// work on the vault while the folders cannot move away.
pub fn with_projects_then<L, T>(
    app: &AppHandle,
    vault_id: &str,
    load: impl FnOnce(&std::path::Path, &ProjectPaths) -> Result<L, AppError>,
    then: impl FnOnce(L) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<crate::state::AppState>();
    let _access = state.read_vault();
    let vault = resolve_vault(app, vault_id)?;
    let loaded = {
        let lock = locking::vault_lock(&vault.root);
        use crate::locks::MutexExt;
        let _io = lock.locked();
        let device = app.state::<crate::services::storage::device::DeviceStore>();
        load(
            &vault.root,
            &ProjectPaths {
                device: &device,
                vault_id: &vault.id,
                protected_roots: protected_roots(app),
            },
        )?
    };
    then(loaded)
}

/// Runs `operation` on two different vaults, each locked as by
/// [`with_vault_of`]; the locks are taken in the order of their folders, so
/// two moves in opposite directions cannot wait on each other.
fn with_two_vaults<T>(
    app: &AppHandle,
    from_id: &str,
    to_id: &str,
    operation: impl FnOnce(&Vault, &Vault) -> Result<T, AppError>,
) -> Result<T, AppError> {
    use crate::locks::MutexExt;
    let state = app.state::<crate::state::AppState>();
    let _access = state.read_vault();
    let from = resolve_vault(app, from_id)?;
    let to = resolve_vault(app, to_id)?;
    if from.id == to.id {
        return Err(AppError::InvalidInput(
            "The destination is the workspace the item is in already".into(),
        ));
    }
    let (first, second) = if from.root <= to.root {
        (&from, &to)
    } else {
        (&to, &from)
    };
    let first_lock = locking::vault_lock(&first.root);
    let second_lock = locking::vault_lock(&second.root);
    let _first = first_lock.locked();
    let _second = second_lock.locked();
    operation(&from, &to)
}

/// Moves a profile, named by its reference, to the vault `to_id` (empty: the
/// main one). Returns its reference there; the webview rewrites the
/// references in the settings.
pub fn move_profile_to_vault(
    app: &AppHandle,
    profile_ref: &str,
    to_id: &str,
) -> Result<MovedEntity, AppError> {
    let (from_id, id) = split_ref(profile_ref);
    let (from_ref, moved) = with_two_vaults(app, from_id, to_id, |from, to| {
        let moved = crate::services::storage::while_chats_locked_in_vault(app, || {
            transfer::move_profile(&from.root, &to.root, id)
        })?;
        app.state::<MemoryReadVersions>()
            .clear_profile(&from.root, id);
        if let Err(error) = crate::services::storage::remove_profile_index(app, &from.id, id) {
            log::warn!("Could not remove the chat index of the profile {id}: {error}");
        }
        Ok((
            join_ref(&canonical_vault_ref(app, from_id, from), id),
            MovedEntity {
                id: join_ref(&canonical_vault_ref(app, to_id, to), &moved.id),
            },
        ))
    })?;
    crate::services::storage::move_session_chats(app, &from_ref, Some(&moved.id));
    // after the vault locks are released: a settings save takes vault access
    // itself. The profile is moved already, so a failure here is only logged
    // and leaves the settings naming a profile that is gone.
    let mut probe = Value::clone(&app.state::<crate::state::AppState>().user_config());
    if !config_refs::rewrite_profile_refs(&mut probe, &from_ref, &moved.id) {
        return Ok(moved);
    }
    if let Err(error) = crate::services::settings::update_user_config(app, |config| {
        config_refs::rewrite_profile_refs(config, &from_ref, &moved.id);
    }) {
        log::error!("Could not point the settings to the moved profile {id}: {error}");
    }
    Ok(moved)
}

/// Moves a project, named by its reference, to the vault `to_id` (empty: the
/// main one). Returns its reference there.
pub fn move_project_to_vault(
    app: &AppHandle,
    project_ref: &str,
    to_id: &str,
) -> Result<MovedEntity, AppError> {
    let (from_id, id) = split_ref(project_ref);
    with_two_vaults(app, from_id, to_id, |from, to| {
        let device = app.state::<crate::services::storage::device::DeviceStore>();
        let from_paths = ProjectPaths {
            device: &device,
            vault_id: &from.id,
            protected_roots: protected_roots(app),
        };
        let to_paths = ProjectPaths {
            device: &device,
            vault_id: &to.id,
            protected_roots: protected_roots(app),
        };
        let moved = transfer::move_project(&from.root, &from_paths, &to.root, &to_paths, id)?;
        Ok(MovedEntity {
            id: join_ref(&canonical_vault_ref(app, to_id, to), &moved.id),
        })
    })
}
