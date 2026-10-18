//! Opt-in tests against real display servers. Run only in an isolated session.
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::json;

use super::{clipboard_restore, kwin, text_injector, x11};
use crate::services::background::BackgroundServices;
use crate::services::platform::window_tracker::{tracker, WindowKind};

const WAIT: Duration = Duration::from_secs(10);

fn eventually(description: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !condition() {
        assert!(Instant::now() < deadline, "Timed out: {description}");
        thread::sleep(Duration::from_millis(25));
    }
}

struct Editor {
    child: Child,
    root: PathBuf,
    name: &'static str,
}

impl Editor {
    fn start(root: &Path, name: &'static str) -> Self {
        let child = Command::new("/usr/bin/python3")
            .arg("../scripts/linux-platform/editor.py")
            .arg(root)
            .arg(name)
            .spawn()
            .expect("Start GTK test editor");
        let editor = Self {
            child,
            root: root.into(),
            name,
        };
        eventually("GTK editor ready and focused", || {
            editor.text().is_some() && editor.is_focused()
        });
        editor
    }

    fn is_focused(&self) -> bool {
        std::fs::read_to_string(self.root.join(format!("{}.focused", self.name)))
            .ok()
            .as_deref()
            == Some("True")
    }

    fn text(&self) -> Option<String> {
        std::fs::read_to_string(self.root.join(format!("{}.text", self.name))).ok()
    }

    fn action(&self, action: &str) {
        let ack = self.root.join(format!("{}.ack", self.name));
        let _ = std::fs::remove_file(&ack);
        let path = self.root.join(format!("{}.command", self.name));
        let temporary = path.with_extension("tmp-command");
        std::fs::write(&temporary, action).unwrap();
        std::fs::rename(temporary, path).unwrap();
        eventually("editor acknowledged command", || {
            std::fs::read_to_string(&ack).ok().as_deref() == Some(action)
        });
    }
}

impl Drop for Editor {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Services(BackgroundServices);
impl Drop for Services {
    fn drop(&mut self) {
        self.0.stop();
        assert!(self.0.wait_until(Instant::now() + WAIT));
    }
}

// KWin executes the production scripts and sends actual D-Bus reports here.
// This sink deliberately excludes the Tauri UI and its follow-window behavior.
struct TrackerSink;
#[zbus::interface(name = "org.tyco.KwinTracker")]
impl TrackerSink {
    #[zbus(name = "KwinWindowActivated")]
    fn activated(&self, seq: &str, id: &str, kind: &str, class: &str) {
        tracker().window_activated(seq, id, WindowKind::parse(kind), class);
    }
    #[zbus(name = "KwinWindowClosed")]
    fn closed(&self, seq: &str, id: &str) {
        tracker().window_closed(seq, id);
    }
    #[zbus(name = "KwinWindowMissing")]
    fn missing(&self, id: &str) {
        tracker().window_missing(id);
    }
}

fn copy_data(data: &[u8], mime_type: &str, x11: bool) {
    let (binary, args) = if x11 {
        ("xclip", vec!["-selection", "clipboard", "-t", mime_type])
    } else {
        ("wl-copy", vec!["--type", mime_type])
    };
    let status = crate::services::platform::process::status(
        crate::services::platform::process::command(binary, &args),
        Some(data),
        Duration::from_secs(5),
    )
    .expect("Clipboard writer completed within deadline");
    assert!(status.success(), "Clipboard writer failed: {status}");
}

fn copy(text: &str, x11: bool) {
    copy_data(
        text.as_bytes(),
        if x11 { "UTF8_STRING" } else { "text/plain" },
        x11,
    );
}

fn activate(id: &str, x11: bool) {
    if x11 {
        assert!(Command::new("xdotool")
            .args(["windowactivate", "--sync", id])
            .status()
            .unwrap()
            .success());
    } else {
        kwin::activate_window(id).unwrap();
    }
}

// xdotool switches back to XTest for focused windows. Virtual KWin has no
// physical input backend, so send core X11 events explicitly in this fixture.
fn paste_xwayland(window: u32) {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        ConnectionExt, EventMask, KeyButMask, KeyPressEvent, KEY_PRESS_EVENT, KEY_RELEASE_EVENT,
    };
    let (connection, screen) = x11rb::connect(None).unwrap();
    let setup = connection.setup();
    let mapping = connection
        .get_keyboard_mapping(setup.min_keycode, setup.max_keycode - setup.min_keycode + 1)
        .unwrap()
        .reply()
        .unwrap();
    let offset = mapping
        .keysyms
        .iter()
        .position(|keysym| *keysym == 0x76)
        .expect("V keysym");
    let keycode = setup.min_keycode + (offset / usize::from(mapping.keysyms_per_keycode)) as u8;
    for (response_type, mask) in [
        (KEY_PRESS_EVENT, EventMask::KEY_PRESS),
        (KEY_RELEASE_EVENT, EventMask::KEY_RELEASE),
    ] {
        let event = KeyPressEvent {
            response_type,
            detail: keycode,
            sequence: 0,
            time: x11rb::CURRENT_TIME,
            root: setup.roots[screen].root,
            event: window,
            child: x11rb::NONE,
            root_x: 0,
            root_y: 0,
            event_x: 0,
            event_y: 0,
            state: KeyButMask::CONTROL,
            same_screen: true,
        };
        connection
            .send_event(false, window, mask, event)
            .unwrap()
            .check()
            .unwrap();
    }
    connection.flush().unwrap();
}

#[test]
#[ignore = "Requires an isolated headless compositor; use pnpm test:platform:linux"]
fn integration_headless_platform() {
    let session =
        std::env::var("TYCO_PLATFORM_SESSION").expect("Explicit isolated session required");
    assert!(["x11", "kwin", "sway"].contains(&session.as_str()));
    let is_x11 = session == "x11";
    let root = crate::services::test_support::TestDir::new("headless-platform");
    let services = Services(BackgroundServices::default());
    let _bus = if session == "kwin" {
        let connection = zbus::blocking::connection::Builder::session()
            .unwrap()
            .name("org.tyco.Service")
            .unwrap()
            .serve_at("/org/tyco/Object", TrackerSink)
            .unwrap()
            .build()
            .unwrap();
        services
            .0
            .spawn_thread("headless-kwin", |stop| {
                kwin::supervise_tracker("tyco-test-own", &stop)
            })
            .unwrap();
        Some(connection)
    } else {
        if is_x11 {
            x11::spawn_tracker(&services.0, "tyco-test-own".into(), |_| {}).unwrap();
        }
        None
    };
    if session != "sway" {
        eventually("tracker startup", || tracker().is_running());
    }

    let foreign = Editor::start(&root, "tyco-test-foreign");
    let target = if session != "sway" {
        eventually("foreign activation", || {
            tracker()
                .active_window()
                .is_some_and(|window| window.class.eq_ignore_ascii_case(foreign.name))
        });
        Some(tracker().target().expect("Foreign paste target"))
    } else {
        None
    };

    // Real PRIMARY is distinct from CLIPBOARD, and capture uses the platform API.
    copy("Clipboard sentinel", is_x11);
    foreign.action("select");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    eventually("PRIMARY capture", || {
        runtime
            .block_on(super::capture_selection(target.clone()))
            .as_deref()
            == Some("Selected source text")
    });
    assert_eq!(
        clipboard_restore::read_text().as_deref(),
        Some("Clipboard sentinel")
    );
    foreign.action("clear");

    let injector = text_injector::SystemTextInjector::detect();
    let config = json!({"windowInsertion": {"method": if is_x11 { "xdotool" } else { "ydotool" }}});
    if session == "sway" {
        assert!(!tracker().is_running());
        assert!(super::capture_foreground_target().is_none());
        assert!(clipboard_restore::snapshot().is_none());
        assert!(injector.check_text_injection(&config).is_err());
        assert!(injector.inject_paste(&config, None).is_err());
        copy("Focused ydotool paste", false);
        injector
            .press_in_focused(&config, text_injector::FocusedKeyAction::Paste, false)
            .unwrap();
        eventually("real ydotool paste in foreign Wayland client", || {
            foreign.text().as_deref() == Some("Focused ydotool paste")
        });
    } else {
        let snapshot = clipboard_restore::snapshot().expect("Real clipboard snapshot");
        let own = Editor::start(&root, "tyco-test-own");
        eventually("own window activation", || {
            tracker()
                .active_window()
                .is_some_and(|window| window.class.eq_ignore_ascii_case(own.name))
        });
        let own_id = tracker().active_window().unwrap().id;
        // Both clients now exist. Mapping a new XWayland client can briefly
        // focus the desktop on older KWin; test an explicit application switch.
        activate(target.as_deref().unwrap(), is_x11);
        activate(&own_id, is_x11);
        assert_eq!(
            tracker().target(),
            target,
            "Own window must preserve foreign target"
        );
        copy("Inserted platform text", is_x11);
        if is_x11 {
            injector.check_text_injection(&config).unwrap();
            injector.inject_paste(&config, target.as_deref()).unwrap();
        } else {
            // Virtual KWin has no libinput backend. Exercise its production
            // activation, then send X11 key events directly to the XWayland fixture.
            kwin::activate_window(target.as_deref().unwrap()).unwrap();
            thread::sleep(Duration::from_millis(100));
            let output = super::command::output_with_timeout(
                "xdotool",
                &["search", "--onlyvisible", "--class", "^tyco-test-foreign$"],
                WAIT,
            )
            .expect("XWayland fixture id");
            let id = String::from_utf8(output).unwrap();
            eventually("XWayland keyboard focus after KWin activation", || {
                super::command::output_with_timeout("xdotool", &["getwindowfocus"], WAIT)
                    .and_then(|bytes| String::from_utf8(bytes).ok())
                    .is_some_and(|focused| focused.trim() == id.trim())
            });
            eventually("GTK keyboard focus after KWin activation", || {
                foreign.is_focused()
            });
            // Synchronize the Wayland-to-X11 clipboard bridge before sending keys.
            eventually("XWayland clipboard bridge", || {
                super::command::output_with_timeout(
                    "xclip",
                    &["-selection", "clipboard", "-o"],
                    WAIT,
                )
                .as_deref()
                    == Some(b"Inserted platform text".as_slice())
            });
            paste_xwayland(id.trim().parse().unwrap());
        }
        eventually("paste delivered to foreign editor", || {
            foreign.text().as_deref() == Some("Inserted platform text")
        });
        assert_eq!(own.text().as_deref(), Some(""));
        clipboard_restore::restore_later(snapshot, "Inserted platform text".into());
        eventually("clipboard restored", || {
            clipboard_restore::read_text().as_deref() == Some("Clipboard sentinel")
        });

        // A later user copy must win over a pending restore.
        let snapshot = clipboard_restore::snapshot().unwrap();
        copy("Temporary paste", is_x11);
        clipboard_restore::restore_later(snapshot, "Temporary paste".into());
        copy("New user copy", is_x11);
        thread::sleep(Duration::from_millis(1300));
        assert_eq!(
            clipboard_restore::read_text().as_deref(),
            Some("New user copy")
        );

        // Snapshot/restore must preserve binary bytes, including NULs.
        copy_data(
            b"\x89PNG\r\n\x1a\n\0binary clipboard payload",
            "image/png",
            is_x11,
        );
        let image = clipboard_restore::snapshot().expect("Image clipboard snapshot");
        copy("Temporary text", is_x11);
        clipboard_restore::restore_now(&image);
        eventually("binary clipboard restored", || {
            clipboard_restore::snapshot().as_ref() == Some(&image)
        });
        copy("New user copy", is_x11);

        activate(&own_id, is_x11);
        eventually("own window refocused", || {
            tracker()
                .active_window()
                .is_some_and(|window| window.class.eq_ignore_ascii_case(own.name))
        });
        drop(foreign);
        eventually("closed target forgotten", || tracker().target().is_none());
        if is_x11 {
            assert!(injector.inject_paste(&config, target.as_deref()).is_err());
        } else {
            assert!(kwin::activate_window(target.as_deref().unwrap()).is_err());
        }
        assert_eq!(
            clipboard_restore::read_text().as_deref(),
            Some("New user copy")
        );
    }
    // Shut down KWin while the D-Bus sink is still alive.
    drop(services);
}
