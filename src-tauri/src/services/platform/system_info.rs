//! What an assistant may be told about the computer it helps on: the system
//! by name and the session, nothing that identifies the user or the machine.

use serde::Serialize;

use super::session::{self, DisplayServer};

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
    /// The desktop environment on Linux as the session names it, e.g. `KDE`,
    /// `XFCE` or `ubuntu:GNOME`.
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
            desktop: session::desktop_name(),
        }
    })
    .clone()
}

#[cfg(target_os = "linux")]
fn os_label() -> String {
    let release = os_release_paths(session::is_sandboxed())
        .iter()
        .find_map(|path| std::fs::read_to_string(path).ok())
        .unwrap_or_default();
    linux_label(&release)
}

/// Where `os-release` is, first choice first. In a Flatpak or Snap sandbox
/// `/etc/os-release` names the runtime, not the system: the host's is
/// exposed under `/run/host` and the Snap host file system.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn os_release_paths(is_sandboxed: bool) -> &'static [&'static str] {
    const HOST: &[&str] = &[
        "/run/host/os-release",
        "/run/host/etc/os-release",
        "/run/host/usr/lib/os-release",
        "/var/lib/snapd/hostfs/etc/os-release",
        "/var/lib/snapd/hostfs/usr/lib/os-release",
        "/etc/os-release",
        "/usr/lib/os-release",
    ];
    const NATIVE: &[&str] = &["/etc/os-release", "/usr/lib/os-release"];
    if is_sandboxed {
        HOST
    } else {
        NATIVE
    }
}

#[cfg(target_os = "windows")]
fn os_label() -> String {
    use super::machine::windows_version_value as value;
    windows_label(&WindowsVersion {
        build: value("CurrentBuildNumber").and_then(|build| build.trim().parse().ok()),
        installation_type: value("InstallationType"),
        product_name: value("ProductName"),
        display_version: value("DisplayVersion"),
    })
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

/// What `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion` tells.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Default)]
struct WindowsVersion {
    build: Option<u32>,
    /// `Client` or `Server`.
    installation_type: Option<String>,
    /// e.g. `Windows Server 2022 Datacenter`.
    product_name: Option<String>,
    /// The release, e.g. `24H2`.
    display_version: Option<String>,
}

/// Windows 11 still reports itself as Windows 10 in its product name; its
/// builds start at 22000. A server's product name is right, and its builds
/// overlap the client ones, so it is named by that.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn windows_label(version: &WindowsVersion) -> String {
    let text = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let is_server =
        text(&version.installation_type).is_some_and(|kind| kind.eq_ignore_ascii_case("server"));
    let product = text(&version.product_name);
    let name = match (is_server, product, version.build) {
        (true, Some(product), _) => product,
        (true, None, _) => "Windows Server".to_owned(),
        (false, _, Some(build)) if build >= 22000 => "Windows 11".to_owned(),
        (false, _, Some(build)) if build >= 10240 => "Windows 10".to_owned(),
        _ => "Windows".to_owned(),
    };
    match text(&version.display_version) {
        Some(release) => format!("{name} {release}"),
        None => name,
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

    fn client(build: Option<u32>) -> WindowsVersion {
        WindowsVersion {
            build,
            installation_type: Some("Client".into()),
            product_name: Some("Windows 10 Pro".into()),
            ..Default::default()
        }
    }

    #[test]
    fn tells_windows_11_by_its_build() {
        assert_eq!(windows_label(&client(Some(26100))), "Windows 11");
        assert_eq!(windows_label(&client(Some(19045))), "Windows 10");
        assert_eq!(windows_label(&client(None)), "Windows");
        assert_eq!(windows_label(&WindowsVersion::default()), "Windows");
    }

    #[test]
    fn adds_the_windows_release() {
        let version = WindowsVersion {
            display_version: Some("24H2".into()),
            ..client(Some(26100))
        };
        assert_eq!(windows_label(&version), "Windows 11 24H2");
    }

    #[test]
    fn names_a_windows_server_by_its_product() {
        let server = |build, product: Option<&str>| WindowsVersion {
            build: Some(build),
            installation_type: Some("Server".into()),
            product_name: product.map(Into::into),
            display_version: None,
        };
        assert_eq!(
            windows_label(&server(20348, Some("Windows Server 2022 Datacenter"))),
            "Windows Server 2022 Datacenter"
        );
        assert_eq!(windows_label(&server(26100, None)), "Windows Server");
    }

    #[test]
    fn reads_the_host_release_in_a_sandbox() {
        assert_eq!(os_release_paths(true)[0], "/run/host/os-release");
        assert!(os_release_paths(true).contains(&"/var/lib/snapd/hostfs/etc/os-release"));
        assert_eq!(os_release_paths(false)[0], "/etc/os-release");
        assert!(!os_release_paths(false)
            .iter()
            .any(|path| path.starts_with("/run/host")));
    }
}
