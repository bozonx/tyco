//! Автоматический прогон: хоткей → сразу печать → сколько символов долетело.
//!
//! Меряется не задержка, а потеря. Символы, не дошедшие до поля, ушли в то
//! окно, которое было в фокусе до вызова, — держите там черновик, не терминал.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::thread::sleep;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use evdev::{AttributeSet, KeyCode, KeyEvent, uinput::VirtualDevice};

/// Цифровой ряд даёт одни и те же символы в любой раскладке, в отличие от букв:
/// KEY_A под русской раскладкой приходит как «ф».
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

/// Зонд дошёл, если все его символы идут по порядку. Посторонние символы между
/// ними означают, что кто-то печатал параллельно, — это не потеря.
fn probe_arrived(landed: &str) -> bool {
    let mut expected = PROBE.iter().map(|(_, symbol)| *symbol).peekable();
    for symbol in landed.chars() {
        if expected.peek() == Some(&symbol) {
            expected.next();
        }
    }
    expected.peek().is_none()
}

fn now_ns() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
}

fn socket_path() -> String {
    let dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| String::from("/tmp"));
    let suffix = std::env::var("LAB_SOCKET_SUFFIX").unwrap_or_default();
    format!("{dir}/tauri-quick-lab{suffix}.sock")
}

fn request(line: &str) -> std::io::Result<String> {
    let stream = UnixStream::connect(socket_path())?;
    let mut writer = stream.try_clone()?;
    writeln!(writer, "{line}")?;
    writer.flush()?;
    let mut response = String::new();
    BufReader::new(stream).read_line(&mut response)?;
    Ok(response.trim().to_string())
}

fn press(device: &mut VirtualDevice, key: KeyCode) -> std::io::Result<()> {
    device.emit(&[*KeyEvent::new(key, 1)])?;
    device.emit(&[*KeyEvent::new(key, 0)])
}

fn env_ms(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let trials: u64 = std::env::args().nth(1).and_then(|v| v.parse().ok()).unwrap_or(20);
    let type_delay = env_ms("LAB_TYPE_DELAY", 0);
    let type_interval = env_ms("LAB_TYPE_INTERVAL", 25);
    let settle = env_ms("LAB_SETTLE", 700);
    // Пауза перед каждой попыткой: реальный вызов случается раз в несколько минут,
    // и каждый такой вызов — «холодный». Подряд идущие попытки этого не ловят.
    let idle = env_ms("LAB_IDLE", 0);

    if request("ping")? != "pong" {
        return Err("приложение не отвечает на сокете; запустите его первым".into());
    }

    let keys: AttributeSet<KeyCode> = PROBE.iter().map(|(key, _)| *key).collect();
    let mut device = VirtualDevice::builder()?
        .name("TyCo quick lab probe")
        .with_keys(&keys)?
        .build()?;

    // Композитору нужно заметить новое устройство до первого нажатия.
    sleep(Duration::from_millis(700));

    let mut clean = 0u64;
    let mut polluted = 0u64;

    println!("прогон: {trials} попыток, зонд из {} клавиш, задержка печати {type_delay} мс",
        PROBE.len());
    println!("не печатайте во время прогона: посторонний ввод делает попытку негодной");

    for id in 1..=trials {
        if idle > 0 {
            println!("    простой {idle} мс…");
            sleep(Duration::from_millis(idle));
        }
        request(&format!("show {id} {}", now_ns()))?;

        if type_delay > 0 {
            sleep(Duration::from_millis(type_delay));
        }
        for (key, _) in PROBE {
            press(&mut device, key)?;
            sleep(Duration::from_millis(type_interval));
        }

        sleep(Duration::from_millis(settle));
        let raw = request(&format!("result {id} {}", PROBE.len()))?;
        let trial: serde_json::Value = serde_json::from_str(&raw)?;
        let landed = trial["value"].as_str().unwrap_or("");

        let arrived = probe_arrived(landed);
        let extra = landed.chars().count().saturating_sub(PROBE.len());
        if arrived && extra == 0 {
            clean += 1;
        } else if arrived {
            polluted += 1;
        }

        let verdict = match (arrived, extra) {
            (true, 0) => "OK      ",
            (true, _) => "ПОСТОР. ",
            (false, _) => "ПОТЕРЯ  ",
        };
        println!("{id:>3}: {verdict} «{landed}»");

        request("hide")?;
        sleep(Duration::from_millis(300));
    }

    println!("\nзонд дошёл полностью: {}/{trials} (из них с посторонним вводом: {polluted})",
        clean + polluted);
    if clean + polluted < trials {
        std::process::exit(1);
    }
    Ok(())
}
