//! Desktop notifications for failures of work that runs without a Tyco window:
//! unlike the status bubble, they stay in the notification history.

use crate::errors::AppError;

#[cfg(target_os = "linux")]
pub fn notify(summary: &str, body: &str) -> Result<(), AppError> {
    use std::collections::HashMap;

    use zbus::zvariant::Value;

    let connection = zbus::blocking::Connection::session()
        .map_err(|error| AppError::Message(format!("No session bus: {error}")))?;
    // lets the desktop show the icon and name of the application entry
    let hints = HashMap::from([("desktop-entry", Value::from("com.tyco.app"))]);
    connection
        .call_method(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            Some("org.freedesktop.Notifications"),
            "Notify",
            &(
                "Tyco",
                0u32,
                "com.tyco.app",
                summary,
                body,
                Vec::<&str>::new(),
                hints,
                -1i32,
            ),
        )
        .map_err(|error| AppError::Message(format!("Could not show a notification: {error}")))?;
    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub fn notify(_summary: &str, _body: &str) -> Result<(), AppError> {
    Ok(())
}
