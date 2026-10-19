//! Hotkey provider selection and external compositor binding syntax.
use super::session::{self, Desktop, DisplayServer};
use crate::services::hotkeys::HotkeyTarget;

/// The modifiers of every default shortcut. Ctrl+Alt is AltGr on Windows,
/// which types characters on many layouts (Ctrl+Alt+E is € in German), so
/// Shift joins it there.
pub(crate) const DEFAULT_MODIFIERS: &str = if cfg!(target_os = "windows") {
    "Ctrl+Shift+Alt"
} else {
    "Ctrl+Alt"
};

/// What binds the hotkeys: the desktop portal, the global shortcut API of
/// the system, or the user in the desktop settings with `tyco-ctl`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename = "HotkeyProviderKind")]
pub enum ProviderKind {
    Portal,
    GlobalShortcut,
    External,
}

/// wlroots compositors are configured in their own files: Sway has no
/// GlobalShortcuts portal, and Hyprland's ignores the preferred triggers and
/// needs a binding in `hyprland.conf` anyway, so both get the binding to copy.
pub(crate) fn provider_kind(session: session::Session) -> ProviderKind {
    match (session.display, session.desktop) {
        (DisplayServer::Wayland, Desktop::Hyprland | Desktop::Sway) => ProviderKind::External,
        (DisplayServer::Wayland, _) => ProviderKind::Portal,
        (DisplayServer::X11 | DisplayServer::Native, _) => ProviderKind::GlobalShortcut,
        (DisplayServer::Unknown, _) => ProviderKind::External,
    }
}

pub(crate) fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// The line that binds `target` in the desktop's own configuration; without
/// a shortcut only the command to bind.
pub(crate) fn external_command(target: &HotkeyTarget, shortcut: Option<&str>) -> String {
    let Some(shortcut) = shortcut else {
        return target.cli_command();
    };
    external_command_for(session::current().desktop, target, shortcut)
}

fn external_command_for(desktop: Desktop, target: &HotkeyTarget, shortcut: &str) -> String {
    match desktop {
        Desktop::Hyprland => {
            let (modifiers, key) = hyprland_shortcut(shortcut);
            format!("bind = {modifiers}, {key}, exec, {}", target.cli_command())
        }
        Desktop::Sway => format!(
            "bindsym {} exec {}",
            sway_shortcut(shortcut),
            target.cli_command()
        ),
        _ => target.cli_command(),
    }
}

fn sway_shortcut(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|part| match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => String::from("Control"),
            "alt" => String::from("Mod1"),
            "super" | "meta" | "cmd" | "command" => String::from("Mod4"),
            "shift" => String::from("Shift"),
            "comma" => String::from("comma"),
            _ => part.to_ascii_lowercase(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn hyprland_shortcut(shortcut: &str) -> (String, String) {
    let mut parts = shortcut.split('+').collect::<Vec<_>>();
    let key = parts.pop().unwrap_or_default();
    let modifiers = parts
        .into_iter()
        .map(|modifier| match modifier.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "CTRL",
            "alt" => "ALT",
            "shift" => "SHIFT",
            "super" | "meta" | "cmd" | "command" => "SUPER",
            _ => modifier,
        })
        .collect::<Vec<_>>()
        .join(" ");
    let key = match key.to_ascii_lowercase().as_str() {
        "comma" => "comma".to_owned(),
        _ => key.to_owned(),
    };
    (modifiers, key)
}

pub(crate) async fn shutdown(app: &tauri::AppHandle) {
    portal::shutdown(app).await;
}

/// The GlobalShortcuts portal of the desktop; only Linux desktops have one,
/// elsewhere `provider_kind` never chooses it.
pub(crate) mod portal {
    use tauri::{App, AppHandle};

    use crate::errors::AppError;
    use crate::services::hotkeys::HotkeyBinding;
    #[cfg(target_os = "linux")]
    use crate::services::platform::linux::hotkeys_portal as backend;

    pub(crate) fn manage_state(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
        #[cfg(target_os = "linux")]
        return builder.manage(backend::PortalState::default());
        #[cfg(not(target_os = "linux"))]
        builder
    }

    pub(crate) fn register(app: &mut App, bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
        #[cfg(target_os = "linux")]
        return backend::register(app, bindings);
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (app, bindings);
            Err(AppError::ServiceUnavailable(String::from(
                "The global shortcuts portal is only available on Linux",
            )))
        }
    }

    /// Opens the portal's own dialog for the shortcuts.
    pub(crate) async fn configure(app: &AppHandle) -> Result<(), AppError> {
        #[cfg(target_os = "linux")]
        return backend::configure_portal(app).await;
        #[cfg(not(target_os = "linux"))]
        {
            let _ = app;
            Err(unavailable())
        }
    }

    pub(crate) async fn rebind(app: &AppHandle) -> Result<(), AppError> {
        #[cfg(target_os = "linux")]
        return backend::rebind_portal(app).await;
        #[cfg(not(target_os = "linux"))]
        {
            let _ = app;
            Err(unavailable())
        }
    }

    pub(crate) async fn refresh_system_triggers(app: &AppHandle) {
        #[cfg(target_os = "linux")]
        backend::refresh_system_triggers(app).await;
        #[cfg(not(target_os = "linux"))]
        let _ = app;
    }

    pub(crate) fn can_configure(app: &AppHandle) -> bool {
        #[cfg(target_os = "linux")]
        return backend::can_configure_portal(app);
        #[cfg(not(target_os = "linux"))]
        {
            let _ = app;
            false
        }
    }

    pub(crate) fn is_registered(app: &AppHandle) -> bool {
        #[cfg(target_os = "linux")]
        return tauri::Manager::state::<backend::PortalState>(app)
            .registration()
            .is_some();
        #[cfg(not(target_os = "linux"))]
        {
            let _ = app;
            false
        }
    }

    pub(super) async fn shutdown(app: &AppHandle) {
        #[cfg(target_os = "linux")]
        backend::shutdown(app).await;
        #[cfg(not(target_os = "linux"))]
        let _ = app;
    }

    #[cfg(not(target_os = "linux"))]
    fn unavailable() -> AppError {
        AppError::ServiceUnavailable(String::from(
            "The global shortcuts portal is only available on Linux",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_provider_from_runtime_session() {
        let kind = |display, desktop| provider_kind(session::Session { display, desktop });
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Kde),
            ProviderKind::Portal
        );
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Gnome),
            ProviderKind::Portal
        );
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Other),
            ProviderKind::Portal
        );
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Hyprland),
            ProviderKind::External
        );
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Sway),
            ProviderKind::External
        );
        assert_eq!(
            kind(DisplayServer::X11, Desktop::Hyprland),
            ProviderKind::GlobalShortcut
        );
        assert_eq!(
            kind(DisplayServer::Native, Desktop::Other),
            ProviderKind::GlobalShortcut
        );
        assert_eq!(
            kind(DisplayServer::Unknown, Desktop::Other),
            ProviderKind::External
        );
    }

    #[test]
    fn converts_shortcuts_to_hyprland_syntax() {
        assert_eq!(
            hyprland_shortcut("Ctrl+Alt+E"),
            (String::from("CTRL ALT"), String::from("E"))
        );
        assert_eq!(
            hyprland_shortcut("Super+Shift+Comma"),
            (String::from("SUPER SHIFT"), String::from("comma"))
        );
    }

    #[test]
    fn converts_shortcuts_to_sway_syntax() {
        assert_eq!(sway_shortcut("Ctrl+Alt+E"), "Control+Mod1+e");
        assert_eq!(sway_shortcut("Super+Shift+Comma"), "Mod4+Shift+comma");
    }

    #[test]
    fn generates_complete_compositor_bindings() {
        use crate::services::activation::ActivationMode;
        let target = HotkeyTarget::Mode(ActivationMode::VoiceChat);
        assert_eq!(
            external_command_for(Desktop::Sway, &target, "Ctrl+Alt+E"),
            "bindsym Control+Mod1+e exec tyco-ctl open voice-chat"
        );
        assert_eq!(
            external_command_for(Desktop::Hyprland, &target, "Super+Shift+Comma"),
            "bind = SUPER SHIFT, comma, exec, tyco-ctl open voice-chat"
        );
        assert_eq!(
            external_command_for(Desktop::Other, &target, "Ctrl+Alt+E"),
            "tyco-ctl open voice-chat"
        );
    }

    #[test]
    fn unassigned_external_binding_returns_only_the_activation_command() {
        assert_eq!(
            external_command(&HotkeyTarget::InlineCorrection, None),
            "tyco-ctl replace correction"
        );
    }
}
