//! Windows of terminal emulators. Ctrl+C there interrupts the running
//! program and Ctrl+V does not paste, so they take other keys, and a
//! selection in them is read without pressing any. A window is told by its
//! class and, where the window tracker knows it, by the program name of its
//! process. A terminal missing here gets the keys of any other window: the
//! paste does nothing there, and the copy keys interrupt nothing.

/// The last segment of the application id or the X11 class of a terminal.
#[cfg(any(target_os = "linux", test))]
const TERMINALS: [&str; 44] = [
    "konsole",
    "yakuake",
    "alacritty",
    "kitty",
    "foot",
    "footclient",
    "wezterm",
    "wezterm-gui",
    "xterm",
    "uxterm",
    "urxvt",
    "rxvt",
    "terminator",
    "tilix",
    "ghostty",
    "ptyxis",
    "kgx",
    "contour",
    "rio",
    "st",
    "st-256color",
    "terminology",
    "cool-retro-term",
    "qterminal",
    "blackbox",
    "sakura",
    "guake",
    "tilda",
    "termite",
    "mlterm",
    "eterm",
    "zutty",
    "tabby",
    "hyper",
    "extraterm",
    "warp",
    "cosmicterm",
    "cosmic-term",
    "kmscon",
    "roxterm",
    "terminus",
    "electerm",
    "wave",
    "waveterm",
];

/// Application ids whose last segment is too generic to list above.
#[cfg(any(target_os = "linux", test))]
const TERMINAL_APP_IDS: [&str; 1] = ["org.gnome.console"];

/// Whether `class` names a terminal: a known one or one with "terminal" in
/// its name.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn is_terminal_class(class: &str) -> bool {
    let class = class.trim().to_ascii_lowercase();
    if class.is_empty() {
        return false;
    }
    let name = class.rsplit('.').next().unwrap_or_default();
    TERMINALS.contains(&name)
        || TERMINAL_APP_IDS.contains(&class.as_str())
        || class.contains("terminal")
}

/// Whether a window of application `class`, run by program `process`, is a
/// terminal. The program name catches terminals whose application id is
/// missing or generic, e.g. a terminal started without its desktop file.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn is_terminal_window(class: &str, process: Option<&str>) -> bool {
    is_terminal_class(class) || process.is_some_and(is_terminal_class)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_terminals_by_application_id() {
        for class in [
            "org.kde.konsole",
            "Alacritty",
            "kitty",
            "org.gnome.Ptyxis",
            "org.gnome.Console",
            "xfce4-terminal",
            "URxvt",
            "com.system76.CosmicTerm",
        ] {
            assert!(is_terminal_class(class), "{class}");
        }
        for class in ["firefox", "org.kde.kate", "telegramdesktop", "console", ""] {
            assert!(!is_terminal_class(class), "{class}");
        }
    }

    #[test]
    fn recognizes_terminals_by_program_name() {
        assert!(is_terminal_window("", Some("gnome-terminal-server")));
        assert!(is_terminal_window("unknown", Some("foot")));
        assert!(is_terminal_window("org.kde.konsole", None));
        assert!(!is_terminal_window("firefox", Some("firefox")));
        assert!(!is_terminal_window("", None));
    }
}
