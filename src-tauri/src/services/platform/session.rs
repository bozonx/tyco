//! The graphical session Tyco runs in, detected once from the environment.
//! Every backend choice on Linux depends on it, so it is made in one place:
//! a session started without a login manager (`startx`) has no
//! `XDG_SESSION_TYPE`, and checking that variable alone would take it for an
//! unknown one.

// Only the Linux backends feed the tracker and ask about the session so far.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisplayServer {
    X11,
    Wayland,
    /// Windows and macOS, which have a single native window system.
    Native,
    /// No graphical session, e.g. a TTY or an SSH login.
    Unknown,
}

/// The desktop environment or compositor, as far as Tyco treats them apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Desktop {
    Kde,
    Gnome,
    Hyprland,
    /// Sway and other compositors that take i3 style bindings.
    Sway,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Session {
    pub display: DisplayServer,
    pub desktop: Desktop,
}

impl Session {
    pub fn is_x11(self) -> bool {
        self.display == DisplayServer::X11
    }

    pub fn is_wayland(self) -> bool {
        self.display == DisplayServer::Wayland
    }

    /// KDE Plasma on Wayland, where KWin scripts track foreign windows.
    pub fn is_kde_wayland(self) -> bool {
        self.is_wayland() && self.desktop == Desktop::Kde
    }

    fn from_env(env: impl Fn(&str) -> Option<String>) -> Self {
        if !cfg!(target_os = "linux") {
            return Self {
                display: DisplayServer::Native,
                desktop: Desktop::Other,
            };
        }
        Self {
            display: display_server(
                env("XDG_SESSION_TYPE").as_deref(),
                env("WAYLAND_DISPLAY").is_some(),
                env("DISPLAY").is_some(),
            ),
            desktop: desktop(env("XDG_CURRENT_DESKTOP").as_deref()),
        }
    }
}

/// The session of this process. The environment does not change while it
/// runs, so it is read once.
pub fn current() -> Session {
    static SESSION: OnceLock<Session> = OnceLock::new();
    *SESSION.get_or_init(|| {
        let session = Session::from_env(|name| std::env::var(name).ok());
        log::info!("Detected session: {session:?}");
        session
    })
}

/// `XDG_SESSION_TYPE` wins when it names a graphical session. Otherwise the
/// display variables decide, Wayland first: XWayland sets `DISPLAY` too.
fn display_server(session_type: Option<&str>, wayland: bool, x11: bool) -> DisplayServer {
    match session_type.map(str::to_ascii_lowercase).as_deref() {
        Some("x11") => DisplayServer::X11,
        Some("wayland") => DisplayServer::Wayland,
        _ if wayland => DisplayServer::Wayland,
        _ if x11 => DisplayServer::X11,
        _ => DisplayServer::Unknown,
    }
}

/// `XDG_CURRENT_DESKTOP` is a colon separated list, e.g. `ubuntu:GNOME`.
fn desktop(current_desktop: Option<&str>) -> Desktop {
    let names = current_desktop
        .unwrap_or_default()
        .split(':')
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    let has = |name: &str| names.iter().any(|value| value == name);
    if has("kde") {
        Desktop::Kde
    } else if has("gnome") {
        Desktop::Gnome
    } else if has("hyprland") {
        Desktop::Hyprland
    } else if has("sway") || has("i3") {
        Desktop::Sway
    } else {
        Desktop::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_session_type_wins_over_the_display_variables() {
        assert_eq!(display_server(Some("x11"), true, true), DisplayServer::X11);
        assert_eq!(
            display_server(Some("Wayland"), false, true),
            DisplayServer::Wayland
        );
    }

    #[test]
    fn startx_sessions_are_told_by_the_display_variables() {
        assert_eq!(display_server(None, false, true), DisplayServer::X11);
        assert_eq!(display_server(Some("tty"), false, true), DisplayServer::X11);
        // XWayland sets DISPLAY next to WAYLAND_DISPLAY
        assert_eq!(display_server(None, true, true), DisplayServer::Wayland);
        assert_eq!(display_server(None, false, false), DisplayServer::Unknown);
    }

    #[test]
    fn recognizes_desktops_in_the_list() {
        assert_eq!(desktop(Some("KDE")), Desktop::Kde);
        assert_eq!(desktop(Some("ubuntu:GNOME")), Desktop::Gnome);
        assert_eq!(desktop(Some("Hyprland")), Desktop::Hyprland);
        assert_eq!(desktop(Some("sway")), Desktop::Sway);
        assert_eq!(desktop(Some("i3")), Desktop::Sway);
        assert_eq!(desktop(Some("XFCE")), Desktop::Other);
        assert_eq!(desktop(None), Desktop::Other);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reads_the_environment() {
        let session = Session::from_env(|name| match name {
            "XDG_SESSION_TYPE" => Some(String::from("wayland")),
            "XDG_CURRENT_DESKTOP" => Some(String::from("KDE")),
            _ => None,
        });
        assert!(session.is_kde_wayland());
        assert!(!session.is_x11());
    }
}
