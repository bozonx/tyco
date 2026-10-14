use std::fs;

pub fn default_binary_path(binary_name: &str) -> String {
    let distro = linux_distribution_id();
    binary_path_for_distro(binary_name, distro.as_deref())
}

fn binary_path_for_distro(binary_name: &str, distro: Option<&str>) -> String {
    let prefix = match distro {
        Some("nixos") => "/run/current-system/sw/bin",
        Some("guix") | Some("guixsd") => "/run/current-system/profile/bin",
        _ => "/usr/bin",
    };

    format!("{prefix}/{binary_name}")
}

fn linux_distribution_id() -> Option<String> {
    let os_release = fs::read_to_string("/etc/os-release").ok()?;
    parse_os_release(&os_release)
}

fn parse_os_release(os_release: &str) -> Option<String> {
    os_release.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;

        if key != "ID" {
            return None;
        }

        Some(value.trim_matches('"').to_lowercase())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_distro_id_from_os_release() {
        assert_eq!(
            parse_os_release("NAME=NixOS\nID=nixos\nVERSION=\"23.11\""),
            Some("nixos".into())
        );
        assert_eq!(
            parse_os_release("ID=\"Arch\"\nPRETTY_NAME=\"Arch Linux\""),
            Some("arch".into())
        );
        assert_eq!(parse_os_release("NAME=\"Ubuntu\"\nVERSION=\"24.04\""), None);
        assert_eq!(parse_os_release(""), None);
    }

    #[test]
    fn selects_binary_path_for_known_distributions() {
        assert_eq!(
            binary_path_for_distro("wl-copy", Some("nixos")),
            "/run/current-system/sw/bin/wl-copy"
        );
        assert_eq!(
            binary_path_for_distro("wl-copy", Some("guix")),
            "/run/current-system/profile/bin/wl-copy"
        );
        assert_eq!(
            binary_path_for_distro("wl-copy", Some("guixsd")),
            "/run/current-system/profile/bin/wl-copy"
        );
        assert_eq!(
            binary_path_for_distro("wl-copy", Some("fedora")),
            "/usr/bin/wl-copy"
        );
        assert_eq!(binary_path_for_distro("wl-copy", None), "/usr/bin/wl-copy");
    }
}
