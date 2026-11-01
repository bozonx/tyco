//! Foreign windows on KDE Plasma under Wayland. KWin offers no Wayland
//! protocol that lets a regular client learn or activate another client's
//! window, but it can do both over D-Bus: a long-lived tracker script reports
//! every window activation back to Tyco, and the window runner KWin serves to
//! KRunner activates a window by its id. A one-shot script activates it where
//! that runner is disabled.

use crate::locks::MutexExt;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use super::backoff::Backoff;
use super::dbus::KWIN_SERVICE;
use crate::errors::AppError;
use crate::services::platform::window_tracker::{finish_startup, new_session, tracker};

const SCRIPTING_PATH: &str = "/Scripting";
const RUNNER_PATH: &str = "/WindowsRunner";
const RUNNER_INTERFACE: &str = "org.kde.krunner1";
/// The match id prefix of KWin's window runner for activating a window.
const RUNNER_ACTIVATE: &str = "0_";
const SCRIPTING_INTERFACE: &str = "org.kde.kwin.Scripting";
const SCRIPT_INTERFACE: &str = "org.kde.kwin.Script";
const TRACKER_SCRIPT_NAME: &str = "tyco-window-tracker";
const ACTIVATOR_SCRIPT_NAME: &str = "tyco-window-activator";
const OWN_ACTIVATOR_SCRIPT_NAME: &str = "tyco-own-window-activator";
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(2);
/// The tracker reports the active window right away; silence means the
/// script failed, e.g. on Plasma 5 whose scripting API differs.
const TRACKER_START_TIMEOUT: Duration = Duration::from_secs(2);
/// How often the supervisor checks that KWin still runs the tracker script.
/// A restart of KWin itself is noticed at once, see `watch_kwin_owner`.
const TRACKER_CHECK_INTERVAL: Duration = Duration::from_secs(30);
/// Retries after a failed start.
const TRACKER_RESTART: Backoff = Backoff::new(Duration::from_secs(5), Duration::from_secs(120));
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
function tycoMatchesClass(window, ownClass) {
    if (!ownClass) {
        return false;
    }
    const cls = String(window.resourceClass || "").toLowerCase();
    const name = String(window.resourceName || "").toLowerCase();
    const desktopFile = String(window.desktopFileName || "").toLowerCase();
    return cls === ownClass || name === ownClass || desktopFile === ownClass;
}
function tycoKind(window) {
    // the class covers a sandbox, where Tyco does not know its own pid
    if (window.pid === TYCO_PID || tycoMatchesClass(window, TYCO_CLASS)) {
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

const OWN_ACTIVATOR_SCRIPT: &str = r#"
(function () {
    const pid = __PID__;
    const ownClass = "__CLASS__";
    function matchesOwn(w) {
        if (w.pid === pid) {
            return true;
        }
        if (!ownClass) {
            return false;
        }
        const cls = String(w.resourceClass || "").toLowerCase();
        const name = String(w.resourceName || "").toLowerCase();
        const desktopFile = String(w.desktopFileName || "").toLowerCase();
        return cls === ownClass || name === ownClass || desktopFile === ownClass;
    }
    function activate() {
        const windows = workspace.windowList();
        for (let i = 0; i < windows.length; i++) {
            const w = windows[i];
            if (w.normalWindow && matchesOwn(w)) {
                if (!w.onAllDesktops && workspace.currentDesktop) {
                    if (w.desktops !== undefined) {
                        w.desktops = [workspace.currentDesktop];
                    } else if (w.desktop !== undefined) {
                        w.desktop = workspace.currentDesktop;
                    }
                }
                w.minimized = false;
                workspace.activeWindow = w;
                if (w.demandsAttention) {
                    w.demandsAttention = false;
                }
                return true;
            }
        }
        return false;
    }
    if (!activate()) {
        let tries = 0;
        const timer = new QTimer();
        timer.interval = 50;
        timer.repeat = true;
        timer.triggered.connect(function () {
            tries += 1;
            if (activate() || tries > 10) {
                timer.stop();
            }
        });
        timer.start();
    }
})();
"#;

/// What wakes the supervisor before its next check.
#[derive(Debug, PartialEq, Eq)]
enum SupervisorEvent {
    Stopped,
    /// KWin left the bus (`false`) or took its name again (`true`).
    KwinPresent(bool),
}

/// Keeps the tracker script running for the lifetime of the process: starts
/// it, retries a failed start with a growing delay, and starts it again once
/// KWin no longer runs it or KWin itself was restarted. `own_class` is the
/// resource class of Tyco windows. Must run once Tyco owns its D-Bus name,
/// otherwise the reports of the script get lost. Cancellation unloads the
/// script before the supervisor exits.
pub fn supervise_tracker(own_class: &str, stop: &crate::services::background::StopToken) {
    let (events, wakeups) = std::sync::mpsc::channel();
    forward_stop(stop.clone(), events.clone());
    if let Err(error) = watch_kwin_owner(events) {
        log::debug!("Not watching KWin restarts: {error}");
    }
    let mut failures = 0u32;
    let mut restart = false;
    while !stop.is_stopped() {
        if restart || !tracker_alive() {
            restart = false;
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
        let delay = if failures == 0 {
            TRACKER_CHECK_INTERVAL
        } else {
            TRACKER_RESTART.delay(failures)
        };
        match wakeups.recv_timeout(delay) {
            Ok(SupervisorEvent::Stopped) => break,
            Ok(SupervisorEvent::KwinPresent(false)) => {
                // its windows and the script are gone with it
                log::info!("KWin left the session bus; window tracking pauses");
                tracker().reset(false, String::new());
            }
            Ok(SupervisorEvent::KwinPresent(true)) => {
                log::info!("KWin is back on the session bus; starting the window tracker");
                failures = 0;
                restart = true;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    stop_tracker();
}

/// Turns the cancellation of `stop` into an event, so that the supervisor
/// waits on one channel instead of polling for it.
fn forward_stop(
    stop: crate::services::background::StopToken,
    events: std::sync::mpsc::Sender<SupervisorEvent>,
) {
    let spawned = std::thread::Builder::new()
        .name("kwin-tracker-stop".into())
        .spawn(move || {
            while !stop.wait(Duration::from_secs(3600)) {}
            let _ = events.send(SupervisorEvent::Stopped);
        });
    if let Err(error) = spawned {
        log::warn!("Could not watch for the KWin tracker stop: {error}");
    }
}

/// Reports each change of the owner of KWin's bus name: a restarted KWin,
/// which Plasma does after a crash while applications keep running, has lost
/// the tracker script and every window id. The thread blocks on the signal
/// until the process exits, or until the supervisor is gone.
fn watch_kwin_owner(events: std::sync::mpsc::Sender<SupervisorEvent>) -> Result<(), AppError> {
    let connection = session()?;
    let proxy = zbus::blocking::fdo::DBusProxy::new(&connection).map_err(dbus_error)?;
    let changes = proxy
        .receive_name_owner_changed_with_args(&[(0, KWIN_SERVICE)])
        .map_err(dbus_error)?;
    std::thread::Builder::new()
        .name("kwin-owner-watch".into())
        .spawn(move || {
            let _connection = connection;
            for change in changes {
                let Ok(args) = change.args() else {
                    continue;
                };
                let present = args.new_owner().is_some();
                if events.send(SupervisorEvent::KwinPresent(present)).is_err() {
                    return;
                }
            }
        })?;
    Ok(())
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
    let own_class = own_class.to_ascii_lowercase();
    let source = TRACKER_SCRIPT
        .replace("__PID__", &std::process::id().to_string())
        .replace(
            "__CLASS__",
            if is_class_name(&own_class) {
                &own_class
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
                AppError::ServiceUnavailable(String::from(
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
    // a second activation alongside could unload or overwrite the activator
    // script of the first, and both would wait for different windows
    static ACTIVATION: Mutex<()> = Mutex::new(());

    if !is_window_id(id) {
        return Err(AppError::InvalidInput(format!(
            "Invalid KWin window id: {id}"
        )));
    }
    let _activation = ACTIVATION.locked();
    tracker().forget_missing();
    match activate_with_runner(id) {
        Ok(true) => tracker().wait_until_active(id, ACTIVATION_TIMEOUT),
        Ok(false) => {
            tracker().window_missing(id);
            Err(AppError::Stale(String::from(
                "The target window has been closed",
            )))
        }
        Err(error) => {
            log::debug!("KWin window runner is unavailable, activating with a script: {error}");
            activate_with_script(id)
        }
    }
}

/// Activates the window with KWin's window runner, one D-Bus call instead of
/// loading a script; `false` when KWin has no such window.
fn activate_with_runner(id: &str) -> Result<bool, AppError> {
    let connection = session()?;
    if window_info(&connection, id)?.is_empty() {
        return Ok(false);
    }
    connection
        .call_method(
            Some(KWIN_SERVICE),
            RUNNER_PATH,
            Some(RUNNER_INTERFACE),
            "Run",
            &(format!("{RUNNER_ACTIVATE}{id}"), ""),
        )
        .map_err(dbus_error)?;
    Ok(true)
}

fn activate_with_script(id: &str) -> Result<(), AppError> {
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

type WindowInfo = std::collections::HashMap<String, zbus::zvariant::OwnedValue>;

/// KWin's description of the window; empty when there is no such window.
fn window_info(connection: &zbus::blocking::Connection, id: &str) -> Result<WindowInfo, AppError> {
    connection
        .call_method(
            Some(KWIN_SERVICE),
            "/KWin",
            Some(KWIN_SERVICE),
            "getWindowInfo",
            &(id,),
        )
        .map_err(dbus_error)?
        .body()
        .deserialize()
        .map_err(dbus_error)
}

/// Moves Tyco's normal window to the active desktop and focuses it.
pub fn activate_own_window(own_class: &str) -> Result<(), AppError> {
    static ACTIVATION: Mutex<()> = Mutex::new(());
    let _activation = ACTIVATION.locked();
    let own_class = own_class.to_ascii_lowercase();
    let source = OWN_ACTIVATOR_SCRIPT
        .replace("__PID__", &std::process::id().to_string())
        .replace(
            "__CLASS__",
            if is_class_name(&own_class) {
                &own_class
            } else {
                ""
            },
        );
    run_script(OWN_ACTIVATOR_SCRIPT_NAME, &source)
}

/// Logical center of a target window, before Tyco changes desktop focus.
pub fn window_center(id: &str) -> Option<(i32, i32)> {
    if !is_window_id(id) {
        return None;
    }
    query_off_runtime(|| query_window_center(id))
}

fn query_off_runtime(query: impl FnOnce() -> Option<(i32, i32)> + Send) -> Option<(i32, i32)> {
    // Hotkeys may arrive on Tokio workers. zbus's blocking facade must not
    // start its runtime inside that executor or on GTK's main thread.
    std::thread::scope(|scope| scope.spawn(query).join().ok().flatten())
}

fn query_window_center(id: &str) -> Option<(i32, i32)> {
    let connection = zbus::blocking::connection::Builder::session()
        .ok()?
        .method_timeout(Duration::from_millis(500))
        .build()
        .ok()?;
    center_from_fields(&window_info(&connection, id).ok()?)
}

fn center_from_fields(fields: &WindowInfo) -> Option<(i32, i32)> {
    let number = |name: &str| {
        let value = fields.get(name)?;
        f64::try_from(value)
            .ok()
            .or_else(|| i32::try_from(value).ok().map(f64::from))
    };
    let (x, y, width, height) = (
        number("x")?,
        number("y")?,
        number("width")?,
        number("height")?,
    );
    if ![x, y, width, height].iter().all(|value| value.is_finite()) || width <= 0.0 || height <= 0.0
    {
        return None;
    }
    Some((
        (x + width / 2.0).round() as i32,
        (y + height / 2.0).round() as i32,
    ))
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
    AppError::Failed(format!("KWin D-Bus call failed: {error}"))
}

/// A directory only this user can write to: KWin runs whatever script file
/// it finds there, and reads it only some time after `run`. Without
/// `XDG_RUNTIME_DIR` it is a directory of this user in the shared temporary
/// one, checked to be theirs alone.
fn scripts_dir() -> Result<PathBuf, AppError> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

    // SAFETY: plain system call without arguments
    let uid = unsafe { libc::geteuid() };
    let directory = scripts_dir_in(
        std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from),
        std::env::var("FLATPAK_ID").ok(),
    )
    .unwrap_or_else(|| std::env::temp_dir().join(format!("tyco-{uid}")));
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
        return Err(AppError::Failed(format!(
            "{} must be a directory of the current user that others cannot write to",
            directory.display()
        )));
    }
    Ok(directory)
}

/// KWin reads the script from the host. A Flatpak shares only its own
/// directory of the runtime one with the host, under the same path.
fn scripts_dir_in(runtime: Option<PathBuf>, flatpak_id: Option<String>) -> Option<PathBuf> {
    let runtime = runtime?;
    Some(match flatpak_id.filter(|id| !id.is_empty()) {
        Some(id) => runtime.join("app").join(id).join("tyco"),
        None => runtime.join("tyco"),
    })
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
        .ok_or_else(|| AppError::InvalidInput(String::from("Script path is not valid UTF-8")))?;

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
        return Err(AppError::Failed(format!(
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
    fn the_window_runner_activates_by_internal_id() {
        assert_eq!(
            format!("{RUNNER_ACTIVATE}{WINDOW}"),
            "0_{da63572a-f14f-4bda-bc6e-fad90679a426}"
        );
    }

    #[test]
    fn accepts_only_application_ids_as_the_own_class() {
        assert!(is_class_name("tyco"));
        assert!(is_class_name("com.tyco.app"));
        assert!(!is_class_name(""));
        assert!(!is_class_name("a\"; workspace.activeWindow = null; \""));
    }

    #[test]
    fn own_activator_script_substitutes_pid_and_class() {
        let source = OWN_ACTIVATOR_SCRIPT
            .replace("__PID__", "12345")
            .replace("__CLASS__", "tyco");
        assert!(source.contains("const pid = 12345;"));
        assert!(source.contains("const ownClass = \"tyco\";"));
        assert!(source.contains("w.desktops = [workspace.currentDesktop]"));
        assert!(source.contains("workspace.activeWindow = w;"));
    }

    #[test]
    fn a_flatpak_writes_scripts_where_the_host_sees_them() {
        let runtime = Some(PathBuf::from("/run/user/1000"));
        assert_eq!(
            scripts_dir_in(runtime.clone(), None),
            Some(PathBuf::from("/run/user/1000/tyco"))
        );
        assert_eq!(
            scripts_dir_in(runtime, Some(String::from("com.tyco.app"))),
            Some(PathBuf::from("/run/user/1000/app/com.tyco.app/tyco"))
        );
        assert_eq!(scripts_dir_in(None, None), None);
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

#[cfg(test)]
mod monitor_tests {
    use super::*;
    #[test]
    fn target_center_supports_negative_and_fractional_logical_coordinates() {
        let fields = [
            ("x", -1280.5),
            ("y", 100.0),
            ("width", 640.0),
            ("height", 400.0),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_owned(), zbus::zvariant::OwnedValue::from(value)))
        .collect();
        assert_eq!(center_from_fields(&fields), Some((-961, 300)));
    }
    #[tokio::test]
    async fn hotkey_monitor_queries_run_outside_the_async_executor() {
        assert_eq!(
            query_off_runtime(|| {
                assert!(tokio::runtime::Handle::try_current().is_err());
                Some((100, 200))
            }),
            Some((100, 200))
        );
    }

    #[test]
    fn a_closed_or_invalid_target_has_no_monitor_point() {
        assert_eq!(center_from_fields(&std::collections::HashMap::new()), None);
        assert_eq!(window_center("invalid target"), None);
    }
}
