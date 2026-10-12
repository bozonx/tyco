//! Running the command line tools of the session: `xclip`, `wl-paste`,
//! `xdotool`. They wait on another client, e.g. the owner of a selection,
//! which may never answer; a caller must not wait with them for good.

use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const POLL_INTERVAL: Duration = Duration::from_millis(10);

/// The standard output of `program`, or `None` when it fails, cannot be
/// started, or does not finish within `timeout` and is killed.
pub fn output_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<Vec<u8>> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut output = Vec::new();
        stdout.read_to_end(&mut output).map(|_| output)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().ok()? {
            break status;
        }
        if Instant::now() >= deadline {
            log::debug!("{program} did not finish in {timeout:?}");
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(POLL_INTERVAL);
    };
    let output = reader.join().ok()?.ok()?;
    status.success().then_some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_the_output_of_a_finished_command() {
        assert_eq!(
            output_with_timeout("printf", &["%s", "text"], Duration::from_secs(5)),
            Some(b"text".to_vec())
        );
        assert_eq!(
            output_with_timeout("false", &[], Duration::from_secs(5)),
            None
        );
    }

    #[test]
    fn kills_a_command_that_does_not_answer() {
        let started = Instant::now();
        assert_eq!(
            output_with_timeout("sleep", &["10"], Duration::from_millis(100)),
            None
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
