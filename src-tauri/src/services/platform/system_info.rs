//! What an assistant may be told about the computer it helps on: the system
//! by name and the session, nothing that identifies the user or the machine.

use serde::Serialize;

use super::session::{self, Desktop, DisplayServer};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// The system as people name it, e.g. `Linux (Fedora Linux 44)` or
    /// `Windows 11`.
    pub os: String,
    /// The processor architecture, e.g. `x86_64`.
    pub arch: String,
    /// The window system on Linux, `x11` or `wayland`; `None` elsewhere.
    pub display_server: Option<String>,
    /// The desktop environment on Linux when Tyco knows it, e.g. `KDE`.
    pub desktop: Option<String>,
}

/// The system info, read once: it does not change while the app runs.
pub fn current() -> SystemInfo {
    static INFO: std::sync::OnceLock<SystemInfo> = std::sync::OnceLock::new();
    INFO.get_or_init(|| {
        let session = session::current();
        SystemInfo {
            os: os_label(),
            arch: std::env::consts::ARCH.to_owned(),
            display_server: match session.display {
                DisplayServer::X11 => Some("x11".into()),
                DisplayServer::Wayland => Some("wayland".into()),
                DisplayServer::Native | DisplayServer::Unknown => None,
            },
            desktop: match session.desktop {
                Desktop::Kde => Some("KDE".into()),
                Desktop::Gnome => Some("GNOME".into()),
                Desktop::Hyprland => Some("Hyprland".into()),
                Desktop::Sway => Some("Sway".into()),
                Desktop::Other => None,
            },
        }
    })
    .clone()
}

#[cfg(target_os = "linux")]
fn os_label() -> String {
    let release = std::fs::read_to_string("/etc/os-release")
        .or_else(|_| std::fs::read_to_string("/usr/lib/os-release"))
        .unwrap_or_default();
    linux_label(&release)
}

#[cfg(target_os = "windows")]
fn os_label() -> String {
    let build = super::machine::windows_version_value("CurrentBuildNumber")
        .and_then(|build| build.trim().parse::<u32>().ok());
    windows_label(build)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn os_label() -> String {
    std::env::consts::OS.to_owned()
}

/// `Linux (<distribution>)` from `os-release`, or `Linux` without one.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn linux_label(os_release: &str) -> String {
    let field = |key: &str| {
        os_release.lines().find_map(|line| {
            let (name, value) = line.split_once('=')?;
            let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
            (name.trim() == key && !value.is_empty()).then(|| value.to_owned())
        })
    };
    match field("PRETTY_NAME").or_else(|| field("NAME")) {
        Some(name) => format!("Linux ({name})"),
        None => "Linux".to_owned(),
    }
}

/// Windows 11 still reports itself as Windows 10 in its product name; its
/// builds start at 22000.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn windows_label(build: Option<u32>) -> String {
    match build {
        Some(build) if build >= 22000 => "Windows 11".to_owned(),
        Some(build) if build >= 10240 => "Windows 10".to_owned(),
        _ => "Windows".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_linux_distribution() {
        assert_eq!(
            linux_label("NAME=\"Fedora Linux\"\nPRETTY_NAME=\"Fedora Linux 44 (KDE Plasma)\"\n"),
            "Linux (Fedora Linux 44 (KDE Plasma))"
        );
        assert_eq!(linux_label("NAME='Arch Linux'\n"), "Linux (Arch Linux)");
        assert_eq!(linux_label("PRETTY_NAME=\"\"\n"), "Linux");
        assert_eq!(linux_label(""), "Linux");
    }

    #[test]
    fn tells_windows_11_by_its_build() {
        assert_eq!(windows_label(Some(26100)), "Windows 11");
        assert_eq!(windows_label(Some(19045)), "Windows 10");
        assert_eq!(windows_label(None), "Windows");
    }
}
