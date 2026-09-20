use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;

pub fn socket_path() -> PathBuf {
    let dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| String::from("/tmp"));
    let suffix = std::env::var("LAB_SOCKET_SUFFIX").unwrap_or_default();
    PathBuf::from(dir).join(format!("tauri-quick-lab{suffix}.sock"))
}

/// Одна команда на строку, один ответ на строку.
pub fn serve<F>(handler: F) -> std::io::Result<()>
where
    F: Fn(&str) -> String + Send + 'static,
{
    let path = socket_path();
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path)?;

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let mut writer = match stream.try_clone() {
                Ok(clone) => clone,
                Err(_) => continue,
            };
            let reader = BufReader::new(stream);

            for line in reader.lines() {
                let Ok(line) = line else { break };
                let response = handler(line.trim());
                if writeln!(writer, "{response}").is_err() {
                    break;
                }
                let _ = writer.flush();
            }
        }
    });

    Ok(())
}
