//! The desktop's own keyboard shortcut settings. Shortcuts bound through the
//! GlobalShortcuts portal belong to the desktop, so they are changed there
//! when the portal cannot show its configuration dialog.

use std::process::Command;

use super::session::{self, Desktop};
use crate::errors::AppError;

fn settings_command(desktop: Desktop) -> Option<(&'static str, &'static [&'static str])> {
    match desktop {
        Desktop::Kde => Some(("systemsettings", &["kcm_keys"])),
        Desktop::Gnome => Some(("gnome-control-center", &["keyboard"])),
        Desktop::Hyprland | Desktop::Sway | Desktop::Other => None,
    }
}

pub fn open_shortcut_settings() -> Result<(), AppError> {
    let (program, args) = settings_command(session::current().desktop).ok_or_else(|| {
        AppError::Message(String::from(
            "This desktop has no shortcut settings to open",
        ))
    })?;
    let mut child = Command::new(program)
        .args(args)
        .spawn()
        .map_err(|error| AppError::Message(format!("Could not start {program}: {error}")))?;
    // reap the settings app once it is closed
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_the_shortcut_settings_of_known_desktops() {
        assert_eq!(
            settings_command(Desktop::Kde),
            Some(("systemsettings", &["kcm_keys"][..]))
        );
        assert_eq!(
            settings_command(Desktop::Gnome),
            Some(("gnome-control-center", &["keyboard"][..]))
        );
        assert_eq!(settings_command(Desktop::Sway), None);
    }
}
