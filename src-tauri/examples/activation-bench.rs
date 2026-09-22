use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::thread::sleep;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use evdev::{uinput::VirtualDevice, AttributeSet, KeyCode, KeyEvent};

const PROBE: [(KeyCode, char); 8] = [
    (KeyCode::KEY_1, '1'),
    (KeyCode::KEY_2, '2'),
    (KeyCode::KEY_3, '3'),
    (KeyCode::KEY_4, '4'),
    (KeyCode::KEY_5, '5'),
    (KeyCode::KEY_6, '6'),
    (KeyCode::KEY_7, '7'),
    (KeyCode::KEY_8, '8'),
];

fn now_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before Unix epoch")
        .as_nanos()
}

fn env_ms(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn socket_path() -> String {
    let directory = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| String::from("/tmp"));
    let suffix = std::env::var("TYCO_METRICS_SOCKET_SUFFIX").unwrap_or_default();
    format!("{directory}/tyco-activation-metrics{suffix}.sock")
}

fn request(line: &str) -> std::io::Result<String> {
    let stream = UnixStream::connect(socket_path())?;
    let mut writer = stream.try_clone()?;
    writeln!(writer, "{line}")?;
    writer.flush()?;
    let mut response = String::new();
    BufReader::new(stream).read_line(&mut response)?;
    Ok(response.trim().to_owned())
}

fn press(device: &mut VirtualDevice, key: KeyCode) -> std::io::Result<()> {
    device.emit(&[*KeyEvent::new(key, 1)])?;
    device.emit(&[*KeyEvent::new(key, 0)])
}

fn probe_arrived(value: &str) -> bool {
    let mut expected = PROBE.iter().map(|(_, character)| *character).peekable();
    for character in value.chars() {
        if expected.peek() == Some(&character) {
            expected.next();
        }
    }
    expected.peek().is_none()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let trials = std::env::args()
        .nth(1)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(20);
    let type_delay = env_ms("TYCO_BENCH_TYPE_DELAY", 100);
    let type_interval = env_ms("TYCO_BENCH_TYPE_INTERVAL", 25);
    let settle = env_ms("TYCO_BENCH_SETTLE", 700);
    let idle = env_ms("TYCO_BENCH_IDLE", 10_000);

    if request("ping")? != "pong" {
        return Err("Tyco activation metrics socket did not respond".into());
    }
    let keys: AttributeSet<KeyCode> = PROBE.iter().map(|(key, _)| *key).collect();
    let mut device = VirtualDevice::builder()?
        .name("Tyco activation benchmark probe")
        .with_keys(&keys)?
        .build()?;
    sleep(Duration::from_millis(700));

    let mut successful = 0;
    for id in 1..=trials {
        if idle > 0 {
            sleep(Duration::from_millis(idle));
        }
        request(&format!("show {id} {}", now_ns()))?;
        sleep(Duration::from_millis(type_delay));
        for (key, _) in PROBE {
            press(&mut device, key)?;
            sleep(Duration::from_millis(type_interval));
        }
        sleep(Duration::from_millis(settle));

        let response = request(&format!("result {id} {}", PROBE.len()))?;
        let trial: serde_json::Value = serde_json::from_str(&response)?;
        let value = trial["value"].as_str().unwrap_or_default();
        let arrived = probe_arrived(value);
        if arrived {
            successful += 1;
        }
        println!("{id:>3}: {} {value:?}", if arrived { "OK" } else { "LOST" });
        request("hide")?;
        sleep(Duration::from_millis(300));
    }

    println!("Probe arrived: {successful}/{trials}");
    if successful != trials {
        std::process::exit(1);
    }
    Ok(())
}
