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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderKind {
    Portal,
    GlobalShortcut,
    External,
}

impl ProviderKind {
    pub(crate) fn as_u8(self) -> u8 {
        match self {
            Self::Portal => 0,
            Self::GlobalShortcut => 1,
            Self::External => 2,
        }
    }

    pub(crate) fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Portal,
            1 => Self::GlobalShortcut,
            _ => Self::External,
        }
    }
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
        use crate::services::activation::StartMode;
        let target = HotkeyTarget::Mode(StartMode::VoiceChat);
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
            "tyco-ctl run default:core.correct:fix --selection --replace --interactive"
        );
    }
}
