use std::fs;

pub fn default_binary_path(binary_name: &str) -> String {
    let prefix = match linux_distribution_id().as_deref() {
        Some("nixos") => "/run/current-system/sw/bin",
        Some("guix") | Some("guixsd") => "/run/current-system/profile/bin",
        _ => "/usr/bin",
    };

    format!("{prefix}/{binary_name}")
}

fn linux_distribution_id() -> Option<String> {
    let os_release = fs::read_to_string("/etc/os-release").ok()?;

    os_release.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;

        if key != "ID" {
            return None;
        }

        Some(value.trim_matches('"').to_lowercase())
    })
}
