//! Running the command line tools of the session: `xclip`, `wl-paste`,
//! `xdotool`. They wait on another client, e.g. the owner of a selection,
//! which may never answer; a caller must not wait with them for good.

use std::time::Duration;

pub fn output_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<Vec<u8>> {
    let (status, bytes) =
        super::super::process::run(super::super::process::command(program, args), None, timeout)
            .ok()?;
    status.success().then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

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
