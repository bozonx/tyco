//! Foreign windows on KDE Plasma under Wayland. No Wayland protocol lets a
//! regular client learn or activate another client's window, but KWin scripts
//! can do both: a long-lived tracker script reports every window activation
//! back to Tyco over D-Bus, and a one-shot script activates a window by its id.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use crate::errors::AppError;
use crate::services::platform::window_tracker::{finish_startup, new_session, tracker};

const KWIN_SERVICE: &str = "org.kde.KWin";
const SCRIPTING_PATH: &str = "/Scripting";
const SCRIPTING_INTERFACE: &str = "org.kde.kwin.Scripting";
const SCRIPT_INTERFACE: &str = "org.kde.kwin.Script";
const TRACKER_SCRIPT_NAME: &str = "tyco-window-tracker";
const ACTIVATOR_SCRIPT_NAME: &str = "tyco-window-activator";
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(2);
/// The tracker reports the active window right away; silence means the
/// script failed, e.g. on Plasma 5 whose scripting API differs.
const TRACKER_START_TIMEOUT: Duration = Duration::from_secs(2);
/// How often the supervisor checks that KWin still runs the tracker script.
const TRACKER_CHECK_INTERVAL: Duration = Duration::from_secs(30);
/// The first retry after a failed start; each next one waits twice as long.
const TRACKER_RETRY_DELAY: Duration = Duration::from_secs(5);
const TRACKER_MAX_RETRY_DELAY: Duration = Duration::from_secs(120);
/// Failed starts logged as warnings; later ones are logged at debug level.
const TRACKER_LOGGED_FAILURES: u32 = 3;

const TRACKER_SCRIPT: &str = r#"
const TYCO_PID = __PID__;
const TYCO_CLASS = "__CLASS__";
const TYCO_SESSION = "__SESSION__";
let tycoSeq = 0;
// D-Bus calls may be handled out of order, so each report carries its number
function tycoNextSeq() {
    tycoSeq += 1;
    return TYCO_SESSION + ":" + tycoSeq;
}
function tycoKind(window) {
    // the class covers a sandbox, where Tyco does not know its own pid
    if (window.pid === TYCO_PID || (TYCO_CLASS !== "" && window.resourceClass === TYCO_CLASS)) {
        return "own";
    }
    return window.normalWindow || window.dialog ? "foreign" : "other";
}
function tycoReport(window) {
    const id = window ? window.internalId.toString() : "";
    const kind = window ? tycoKind(window) : "other";
    const resourceClass = window ? String(window.resourceClass || "") : "";
    callDBus("org.tyco.Service", "/org/tyco/Object", "org.tyco.KwinTracker", "KwinWindowActivated",
        tycoNextSeq(), id, kind, resourceClass);
}
workspace.windowActivated.connect(tycoReport);
workspace.windowRemoved.connect(function (window) {
    callDBus("org.tyco.Service", "/org/tyco/Object", "org.tyco.KwinTracker", "KwinWindowClosed",
        tycoNextSeq(), window.internalId.toString());
});
tycoReport(workspace.activeWindow);
"#;

const ACTIVATOR_SCRIPT: &str = r#"
(function () {
    const target = "__ID__";
    const windows = workspace.windowList();
    for (let i = 0; i < windows.length; i++) {
        if (windows[i].internalId.toString() === target) {
            workspace.activeWindow = windows[i];
            return;
        }
    }
    callDBus("org.tyco.Service", "/org/tyco/Object", "org.tyco.KwinTracker", "KwinWindowMissing", target);
})();
"#;

/// Keeps the tracker script running for the lifetime of the process: starts
/// it, retries a failed start with a growing delay, and starts it again once
/// KWin no longer runs it. `own_class` is the resource class of Tyco windows.
/// Must run once Tyco owns its D-Bus name, otherwise the reports of the script
/// get lost. Cancellation unloads the script before the supervisor exits.
pub fn supervise_tracker(own_class: &str, stop: &crate::services::background::StopToken) {
    let mut failures = 0u32;
    while !stop.is_stopped() {
        if !tracker_alive() {
            match start_tracker(own_class) {
                Ok(()) => {
                    if failures == 0 {
                        log::info!("Tracking foreign windows with a KWin script");
                    } else {
                        log::info!("KWin window tracker started after {failures} failed attempts");
                    }
                    failures = 0;
                }
                Err(error) => {
                    failures += 1;
                    if failures <= TRACKER_LOGGED_FAILURES {
                        log::warn!("KWin window tracker is unavailable: {error}");
                    } else {
                        log::debug!("KWin window tracker is still unavailable: {error}");
                    }
                }
            }
            finish_startup();
        }
        if stop.wait(if failures == 0 {
            TRACKER_CHECK_INTERVAL
        } else {
            retry_delay(failures)
        }) {
            break;
        }
    }
    stop_tracker();
}

fn retry_delay(failures: u32) -> Duration {
    TRACKER_RETRY_DELAY
        .saturating_mul(2u32.saturating_pow(failures.saturating_sub(1)))
        .min(TRACKER_MAX_RETRY_DELAY)
}

/// Whether the tracker runs as far as KWin can tell. A failed check counts
/// as alive: restarting would drop what the tracker knows, for nothing.
fn tracker_alive() -> bool {
    if !tracker().is_running() {
        return false;
    }
    match session().and_then(|connection| is_script_loaded(&connection, TRACKER_SCRIPT_NAME)) {
        Ok(loaded) => {
            if !loaded {
                log::warn!("KWin no longer runs the window tracker script; starting it again");
            }
            loaded
        }
        Err(error) => {
            log::debug!("Could not check the KWin window tracker: {error}");
            true
        }
    }
}

/// Loads the tracker script and waits for its first report.
fn start_tracker(own_class: &str) -> Result<(), AppError> {
    let session = new_session();
    let source = TRACKER_SCRIPT
        .replace("__PID__", &std::process::id().to_string())
        .replace(
            "__CLASS__",
            if is_class_name(own_class) {
                own_class
            } else {
                ""
            },
        )
        .replace("__SESSION__", &session);
    // before the script runs: resetting the state later could drop its report
    tracker().reset(true, session);
    let started = run_script(TRACKER_SCRIPT_NAME, &source).and_then(|()| {
        tracker()
            .wait_until_reported(TRACKER_START_TIMEOUT)
            .map_err(|_| {
                AppError::Message(String::from(
                    "The KWin window tracker script does not report; KDE Plasma 6 is required",
                ))
            })
    });
    if started.is_err() {
        stop_tracker();
    }
    started
}

/// Goes into a script string literal, so only an application id is allowed.
fn is_class_name(class: &str) -> bool {
    !class.is_empty()
        && class
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '_' | '-'))
}

pub fn stop_tracker() {
    if !tracker().is_running() {
        return;
    }
    tracker().reset(false, String::new());
    if let Err(error) =
        session().and_then(|connection| unload_script(&connection, TRACKER_SCRIPT_NAME))
    {
        log::warn!("Could not unload the KWin window tracker: {error}");
    }
}

/// Activates the window and waits until KWin reports it focused.
pub fn activate_window(id: &str) -> Result<(), AppError> {
    // the activator script has a single name and file: a second activation
    // running alongside would unload or overwrite the script of the first
    static ACTIVATION: Mutex<()> = Mutex::new(());

    if !is_window_id(id) {
        return Err(AppError::Message(format!("Invalid KWin window id: {id}")));
    }
    let _activation = ACTIVATION.lock().unwrap_or_else(|error| error.into_inner());
    tracker().forget_missing();
    run_script(
        ACTIVATOR_SCRIPT_NAME,
        &ACTIVATOR_SCRIPT.replace("__ID__", id),
    )?;
    let result = tracker().wait_until_active(id, ACTIVATION_TIMEOUT);
    if let Err(error) =
        session().and_then(|connection| unload_script(&connection, ACTIVATOR_SCRIPT_NAME))
    {
        log::warn!("Could not unload the KWin window activator: {error}");
    }
    result
}

/// KWin window ids are UUIDs in braces; anything else must not reach a script.
fn is_window_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|char| char.is_ascii_hexdigit() || matches!(char, '{' | '}' | '-'))
}

fn session() -> Result<zbus::blocking::Connection, AppError> {
    zbus::blocking::Connection::session().map_err(dbus_error)
}

fn dbus_error(error: zbus::Error) -> AppError {
    AppError::Message(format!("KWin D-Bus call failed: {error}"))
}

/// A directory only this user can write to: KWin runs whatever script file
/// it finds there, and reads it only some time after `run`. Without
/// `XDG_RUNTIME_DIR` it is a directory of this user in the shared temporary
/// one, checked to be theirs alone.
fn scripts_dir() -> Result<PathBuf, AppError> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

    // SAFETY: plain system call without arguments
    let uid = unsafe { libc::geteuid() };
    let directory = match std::env::var_os("XDG_RUNTIME_DIR") {
        Some(runtime) => PathBuf::from(runtime).join("tyco"),
        None => std::env::temp_dir().join(format!("tyco-{uid}")),
    };
    match std::fs::DirBuilder::new()
        .recursive(false)
        .mode(0o700)
        .create(&directory)
    {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    let metadata = std::fs::symlink_metadata(&directory)?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.permissions().mode() & 0o022 != 0 {
        return Err(AppError::Message(format!(
            "{} must be a directory of the current user that others cannot write to",
            directory.display()
        )));
    }
    Ok(directory)
}

fn is_script_loaded(connection: &zbus::blocking::Connection, name: &str) -> Result<bool, AppError> {
    connection
        .call_method(
            Some(KWIN_SERVICE),
            SCRIPTING_PATH,
            Some(SCRIPTING_INTERFACE),
            "isScriptLoaded",
            &(name,),
        )
        .map_err(dbus_error)?
        .body()
        .deserialize()
        .map_err(dbus_error)
}

fn unload_script(connection: &zbus::blocking::Connection, name: &str) -> Result<(), AppError> {
    connection
        .call_method(
            Some(KWIN_SERVICE),
            SCRIPTING_PATH,
            Some(SCRIPTING_INTERFACE),
            "unloadScript",
            &(name,),
        )
        .map_err(dbus_error)?;
    Ok(())
}

/// Writes a new file, never through a link left in the place of an old one.
fn write_script(path: &std::path::Path, source: &str) -> Result<(), AppError> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(source.as_bytes())?;
    Ok(())
}

/// KWin reads the file asynchronously after `run`, so it is left in place.
fn run_script(name: &str, source: &str) -> Result<(), AppError> {
    let path = scripts_dir()?.join(format!("{name}.js"));
    write_script(&path, source)?;
    let path = path
        .to_str()
        .ok_or_else(|| AppError::Message(String::from("Script path is not valid UTF-8")))?;

    let connection = session()?;
    // a script of a previous run or a crashed instance keeps its name taken
    unload_script(&connection, name)?;
    let id: i32 = connection
        .call_method(
            Some(KWIN_SERVICE),
            SCRIPTING_PATH,
            Some(SCRIPTING_INTERFACE),
            "loadScript",
            &(path, name),
        )
        .map_err(dbus_error)?
        .body()
        .deserialize()
        .map_err(dbus_error)?;
    if id < 0 {
        return Err(AppError::Message(format!(
            "KWin refused to load the script {name}"
        )));
    }
    connection
        .call_method(
            Some(KWIN_SERVICE),
            format!("{SCRIPTING_PATH}/Script{id}").as_str(),
            Some(SCRIPT_INTERFACE),
            "run",
            &(),
        )
        .map_err(dbus_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOW: &str = "{da63572a-f14f-4bda-bc6e-fad90679a426}";

    #[test]
    fn accepts_only_kwin_window_ids() {
        assert!(is_window_id(WINDOW));
        assert!(!is_window_id(""));
        assert!(!is_window_id("\"); workspace.activeWindow = null; (\""));
        assert!(!is_window_id("12345 abc"));
    }

    #[test]
    fn accepts_only_application_ids_as_the_own_class() {
        assert!(is_class_name("tyco"));
        assert!(is_class_name("com.tyco.app"));
        assert!(!is_class_name(""));
        assert!(!is_class_name("a\"; workspace.activeWindow = null; \""));
    }

    #[test]
    fn retries_with_a_growing_but_bounded_delay() {
        assert_eq!(retry_delay(1), TRACKER_RETRY_DELAY);
        assert_eq!(retry_delay(2), TRACKER_RETRY_DELAY * 2);
        assert_eq!(retry_delay(3), TRACKER_RETRY_DELAY * 4);
        assert_eq!(retry_delay(40), TRACKER_MAX_RETRY_DELAY);
    }

    #[test]
    fn scripts_have_their_placeholders_filled() {
        assert!(!TRACKER_SCRIPT
            .replace("__PID__", "1")
            .replace("__CLASS__", "tyco")
            .replace("__SESSION__", "s")
            .contains("__"));
        assert!(!ACTIVATOR_SCRIPT
            .replace("__ID__", WINDOW)
            .contains("__ID__"));
    }
}
