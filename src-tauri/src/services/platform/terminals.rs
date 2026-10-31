//! Windows of terminal emulators. Ctrl+C there interrupts the running
//! program and Ctrl+V does not paste, so they take other keys, and a
//! selection in them is read without pressing any. A window class that is
//! not known here can be named in `windowInsertion.terminalApps`.

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

/// Whether `class` names a terminal: a known one, one with "terminal" in its
/// name, or one the user listed in `extra`.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn is_terminal_class(class: &str, extra: &[String]) -> bool {
    let class = class.trim().to_ascii_lowercase();
    if class.is_empty() {
        return false;
    }
    let name = class.rsplit('.').next().unwrap_or_default();
    TERMINALS.contains(&name)
        || TERMINAL_APP_IDS.contains(&class.as_str())
        || class.contains("terminal")
        || is_listed(&class, extra)
}

/// Whether the user listed `class`, by its full name or its last segment.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
pub(crate) fn is_listed(class: &str, extra: &[String]) -> bool {
    let class = class.trim();
    let name = class.rsplit('.').next().unwrap_or_default();
    extra
        .iter()
        .map(|entry| entry.trim())
        .any(|entry| entry.eq_ignore_ascii_case(class) || entry.eq_ignore_ascii_case(name))
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
            assert!(is_terminal_class(class, &[]), "{class}");
        }
        for class in ["firefox", "org.kde.kate", "telegramdesktop", "console", ""] {
            assert!(!is_terminal_class(class, &[]), "{class}");
        }
    }

    #[test]
    fn listed_classes_are_terminals_by_name_or_last_segment() {
        let extra = vec![String::from(" MyTerm "), String::from("org.example.Shell")];
        assert!(is_terminal_class("myterm", &extra));
        assert!(is_terminal_class("com.vendor.MyTerm", &extra));
        assert!(is_terminal_class("ORG.EXAMPLE.SHELL", &extra));
        assert!(!is_terminal_class("shell", &extra));
        assert!(!is_terminal_class("firefox", &extra));
    }
}
