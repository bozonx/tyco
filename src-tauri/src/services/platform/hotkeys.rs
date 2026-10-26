//! Hotkey provider selection and external compositor binding syntax.
use super::session::{self, Desktop, DisplayServer};
use crate::services::hotkeys::HotkeyTarget;

/// The modifiers of every default shortcut, the same on every platform so
/// that one keyboard layout of a key remapper can trigger them anywhere.
/// Ctrl+Alt alone is AltGr on Windows, which types characters on many
/// layouts (Ctrl+Alt+E is € in German), so Shift joins it.
pub(crate) const DEFAULT_MODIFIERS: &str = "Ctrl+Alt+Shift";

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

/// The XKB keysym name of a key as Tyco spells it (`Comma`, `F5`,
/// `ArrowUp`, `Numpad1`), the name the portal, Sway and Hyprland expect.
pub(crate) fn xkb_key_name(key: &str) -> String {
    let name = match key.to_ascii_lowercase().as_str() {
        "space" => "space",
        "comma" => "comma",
        "period" => "period",
        "minus" => "minus",
        "equal" => "equal",
        "slash" => "slash",
        "backslash" => "backslash",
        "semicolon" => "semicolon",
        "quote" => "apostrophe",
        "bracketleft" => "bracketleft",
        "bracketright" => "bracketright",
        "backquote" => "grave",
        "enter" => "Return",
        "escape" | "esc" => "Escape",
        "tab" => "Tab",
        "backspace" => "BackSpace",
        "delete" => "Delete",
        "insert" => "Insert",
        "home" => "Home",
        "end" => "End",
        "pageup" => "Prior",
        "pagedown" => "Next",
        "arrowup" | "up" => "Up",
        "arrowdown" | "down" => "Down",
        "arrowleft" | "left" => "Left",
        "arrowright" | "right" => "Right",
        "printscreen" => "Print",
        "pause" => "Pause",
        "numpadadd" => "KP_Add",
        "numpadsubtract" => "KP_Subtract",
        "numpadmultiply" => "KP_Multiply",
        "numpaddivide" => "KP_Divide",
        "numpaddecimal" => "KP_Decimal",
        "numpadenter" => "KP_Enter",
        lower => {
            if let Some(digit) = lower.strip_prefix("numpad") {
                return format!("KP_{digit}");
            }
            let is_function_key = lower.len() > 1
                && lower.starts_with('f')
                && lower[1..].chars().all(|char| char.is_ascii_digit());
            if is_function_key {
                return lower.to_ascii_uppercase();
            }
            return lower.to_owned();
        }
    };
    name.to_owned()
}

fn sway_shortcut(shortcut: &str) -> String {
    let mut parts = shortcut.split('+').collect::<Vec<_>>();
    let key = parts.pop().unwrap_or_default();
    parts
        .into_iter()
        .map(|part| match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => String::from("Control"),
            "alt" => String::from("Mod1"),
            "super" | "meta" | "cmd" | "command" => String::from("Mod4"),
            "shift" => String::from("Shift"),
            _ => part.to_owned(),
        })
        .chain([xkb_key_name(key)])
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
    (modifiers, xkb_key_name(key))
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
            (String::from("CTRL ALT"), String::from("e"))
        );
        assert_eq!(
            hyprland_shortcut("Super+Shift+Comma"),
            (String::from("SUPER SHIFT"), String::from("comma"))
        );
    }

    #[test]
    fn names_keys_as_xkb_does() {
        assert_eq!(xkb_key_name("E"), "e");
        assert_eq!(xkb_key_name("7"), "7");
        assert_eq!(xkb_key_name("F5"), "F5");
        assert_eq!(xkb_key_name("F12"), "F12");
        assert_eq!(xkb_key_name("Space"), "space");
        assert_eq!(xkb_key_name("ArrowUp"), "Up");
        assert_eq!(xkb_key_name("Enter"), "Return");
        assert_eq!(xkb_key_name("Escape"), "Escape");
        assert_eq!(xkb_key_name("Backquote"), "grave");
        assert_eq!(xkb_key_name("Quote"), "apostrophe");
        assert_eq!(xkb_key_name("PageDown"), "Next");
        assert_eq!(xkb_key_name("Numpad1"), "KP_1");
        assert_eq!(xkb_key_name("NumpadAdd"), "KP_Add");
    }

    #[test]
    fn converts_shortcuts_to_sway_syntax() {
        assert_eq!(sway_shortcut("Ctrl+Alt+E"), "Control+Mod1+e");
        assert_eq!(sway_shortcut("Super+Shift+Comma"), "Mod4+Shift+comma");
        assert_eq!(sway_shortcut("Ctrl+F5"), "Control+F5");
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
