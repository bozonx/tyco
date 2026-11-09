#[cfg(test)]
mod tests;

pub mod marker;
pub mod memory;
pub mod operations;
pub mod types;

pub use marker::Vault;
pub use memory::*;
pub use operations::*;
pub use types::*;

use tauri::{AppHandle, Manager};

use crate::errors::AppError;

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
    if vault_id.is_empty() {
        return main_vault(app);
    }
    // the main vault named by its own id, e.g. in a reference written by hand
    if let Ok(main) = main_vault(app) {
        if main.id == vault_id {
            return Ok(main);
        }
    }
    let config = app.state::<crate::state::AppState>().user_config();
    let attached = crate::models::user_config::attached_vaults(&config)
        .into_iter()
        .find(|vault| vault.vault_id == vault_id)
        .ok_or_else(|| {
            AppError::VaultUnavailable(format!(
                "The AI vault {vault_id} is not attached on this device"
            ))
        })?;
    let vault = marker::open_attached(std::path::Path::new(&attached.path))?;
    if vault.id != vault_id {
        return Err(AppError::VaultUnavailable(format!(
            "The folder {} holds another AI vault now",
            attached.path
        )));
    }
    Ok(vault)
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
            },
        )
    })
}
