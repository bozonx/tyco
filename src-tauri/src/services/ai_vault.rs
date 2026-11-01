#[cfg(test)]
mod relocation_tests;
#[cfg(test)]
mod tests;

pub mod location;
pub mod marker;
pub mod memory;
pub mod operations;
pub mod relocation;
pub mod types;

pub use marker::Vault;
pub use memory::*;
pub use operations::*;
pub use types::*;

use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::services::storage::user_sub_dir;

/// The vault of `configured_path`, the `aiVault.path` of this device: the
/// default one, inside the user data folder, when it is empty. A chosen
/// folder that is not there is an error, never replaced by another, usually
/// empty, vault; see `marker`.
pub fn open_vault(
    configured_path: Option<&str>,
    user_dir: Option<&std::path::Path>,
    default_dir: impl FnOnce() -> Result<PathBuf, AppError>,
) -> Result<Vault, AppError> {
    match configured_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        None => marker::open_default(&default_dir()?),
        Some(path) => marker::open_external(std::path::Path::new(path), user_dir),
    }
}

/// The vault of the app, see [`open_vault`].
pub fn resolve_vault(app: &AppHandle, user_config: &Value) -> Result<Vault, AppError> {
    let configured = crate::models::user_config::ai_vault(user_config).path;
    let user_dir = crate::services::storage::user_data::user_dir_for(
        app,
        crate::services::storage::UserDirAccess::Read,
    )
    .ok();
    open_vault(Some(&configured), user_dir.as_deref(), || {
        user_sub_dir(app, VAULT_DIR_NAME)
    })
}

/// The folder of the default vault inside the user data folder.
pub const VAULT_DIR_NAME: &str = "ai-vault";

/// The root of the vault of the app, see [`resolve_vault`].
pub fn resolve_vault_path(app: &AppHandle, user_config: &Value) -> Result<PathBuf, AppError> {
    resolve_vault(app, user_config).map(|vault| vault.root)
}

/// Resolve the active vault only after relocation has finished; retain access
/// until all I/O using this path has completed.
pub fn with_vault<T>(
    app: &AppHandle,
    operation: impl FnOnce(&std::path::Path) -> Result<T, AppError>,
) -> Result<T, AppError> {
    with_vault_of(app, |vault| operation(&vault.root))
}

/// [`with_vault`] with the vault and its id.
pub fn with_vault_of<T>(
    app: &AppHandle,
    operation: impl FnOnce(&Vault) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<crate::state::AppState>();
    let _access = state.read_vault();
    let vault = resolve_vault(app, &state.user_config())?;
    operation(&vault)
}

/// [`with_vault`] with the folders the external projects of the vault have
/// on this device.
pub fn with_projects<T>(
    app: &AppHandle,
    operation: impl FnOnce(&std::path::Path, &ProjectPaths) -> Result<T, AppError>,
) -> Result<T, AppError> {
    with_vault_of(app, |vault| {
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
