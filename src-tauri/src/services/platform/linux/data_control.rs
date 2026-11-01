//! Whether the Wayland compositor offers a data control protocol, which lets
//! `wl-paste` and `wl-copy --clear` work without a window of their own.
//! Without it they open a surface to get the keyboard focus, which takes the
//! focus from the target window and makes it flicker, e.g. on GNOME.

use std::sync::OnceLock;

use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::wl_registry;
use wayland_client::{Connection, Dispatch, QueueHandle};

use crate::services::platform::session;

/// The interfaces of the wlroots protocol and of its standard successor.
const DATA_CONTROL_INTERFACES: [&str; 2] = [
    "zwlr_data_control_manager_v1",
    "ext_data_control_manager_v1",
];

/// Asked once: the compositor does not change while Tyco runs.
pub(crate) fn is_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| match query_globals() {
        Ok(interfaces) => {
            let available = has_data_control(interfaces.iter().map(String::as_str));
            log::info!("Wayland data control protocol available: {available}");
            available
        }
        Err(error) => {
            let desktop = session::current().desktop;
            let available = desktop_has_data_control(desktop);
            log::warn!(
                "Cannot list the Wayland globals ({error}); assuming data control is {} on {desktop:?}",
                if available { "available" } else { "missing" }
            );
            available
        }
    })
}

fn has_data_control<'a>(mut interfaces: impl Iterator<Item = &'a str>) -> bool {
    interfaces.any(|interface| DATA_CONTROL_INTERFACES.contains(&interface))
}

/// The desktops known to offer the protocol, when the compositor cannot be
/// asked.
fn desktop_has_data_control(desktop: session::Desktop) -> bool {
    matches!(
        desktop,
        session::Desktop::Kde | session::Desktop::Sway | session::Desktop::Hyprland
    )
}

struct Globals;

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for Globals {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

fn query_globals() -> Result<Vec<String>, String> {
    let connection = Connection::connect_to_env().map_err(|error| error.to_string())?;
    let (globals, _queue) =
        registry_queue_init::<Globals>(&connection).map_err(|error| error.to_string())?;
    Ok(globals
        .contents()
        .with_list(|list| list.iter().map(|global| global.interface.clone()).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_either_data_control_protocol() {
        assert!(has_data_control(
            ["wl_seat", "zwlr_data_control_manager_v1"].into_iter()
        ));
        assert!(has_data_control(
            ["ext_data_control_manager_v1"].into_iter()
        ));
        assert!(!has_data_control(
            ["wl_seat", "wl_data_device_manager"].into_iter()
        ));
    }

    #[test]
    fn falls_back_to_the_known_desktops() {
        assert!(desktop_has_data_control(session::Desktop::Kde));
        assert!(desktop_has_data_control(session::Desktop::Hyprland));
        assert!(!desktop_has_data_control(session::Desktop::Gnome));
        assert!(!desktop_has_data_control(session::Desktop::Other));
    }
}
