use super::primary_selection;
use crate::services::platform::session::{self, DisplayServer};
use crate::services::platform::window_tracker::tracker;

#[derive(Clone, Copy, Debug)]
pub struct SystemForegroundContext {
    display: DisplayServer,
}

impl SystemForegroundContext {
    pub fn detect() -> Self {
        Self {
            display: session::current().display,
        }
    }

    /// The tracker knows the window focused before a Tyco one; without it
    /// X11 can still tell the focused window.
    pub fn capture_foreground_target(&self) -> Option<String> {
        if tracker().is_running() {
            return tracker().target();
        }
        match self.display {
            DisplayServer::X11 => super::x11::active_window(),
            _ => None,
        }
    }

    /// Gives keyboard focus back to `target` when X11 is used. Under Wayland,
    /// disabling the layer-shell panel keyboard returns focus to the underlying
    /// window without composer round-trips or workspace switches.
    pub fn restore_foreground_target(&self, target: &str) {
        if self.display == DisplayServer::X11 {
            super::x11::restore_window_focus(target);
        }
    }

    /// The primary selection, which holds what was selected last in any
    /// window, when it was made in `target`, as far as that is known: see
    /// `primary_selection` on Wayland, the selection owner on X11. Never the
    /// clipboard: a copied text is not a selection.
    pub async fn capture_selection(&self, target: Option<String>) -> Option<String> {
        if !matches!(self.display, DisplayServer::X11 | DisplayServer::Wayland) {
            return None;
        }
        if is_selection_from(self.display, target.as_deref()) == Some(false) {
            return None;
        }
        super::clipboard_restore::read_primary().filter(|text| !text.trim().is_empty())
    }
}

/// Whether the primary selection was made in `target`; `None` when that is
/// not known.
pub(crate) fn is_selection_from(display: DisplayServer, target: Option<&str>) -> Option<bool> {
    match display {
        DisplayServer::X11 => match target {
            Some(target) => super::x11::is_primary_selection_from(target),
            None => Some(false),
        },
        DisplayServer::Wayland => primary_selection::is_selection_from_window(target),
        DisplayServer::Native | DisplayServer::Unknown => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_session_has_no_foreground_target() {
        let context = SystemForegroundContext {
            display: DisplayServer::Unknown,
        };
        assert_eq!(context.capture_foreground_target(), None);
    }
}
