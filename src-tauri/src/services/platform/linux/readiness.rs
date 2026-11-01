//! Blocking waits of the long-lived Linux watchers. They sleep in `poll(2)`
//! until their connection has data or Tyco stops, rather than waking up on a
//! timer to look: an idle desktop app should not wake the CPU many times a
//! second.

use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::time::Duration;

use crate::services::background::StopToken;

/// A descriptor that becomes readable once `stop` is cancelled.
pub(super) struct StopFd(OwnedFd);

impl StopFd {
    pub(super) fn new(stop: &StopToken) -> io::Result<Self> {
        // SAFETY: plain system call; the result is checked before use
        let raw = unsafe { libc::eventfd(0, libc::EFD_CLOEXEC | libc::EFD_NONBLOCK) };
        if raw < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `raw` is a fresh descriptor that nothing else owns
        let fd = unsafe { OwnedFd::from_raw_fd(raw) };
        let signal = fd.try_clone()?;
        let stop = stop.clone();
        std::thread::Builder::new()
            .name("stop-fd".into())
            .spawn(move || {
                while !stop.wait(Duration::from_secs(3600)) {}
                let one = 1u64.to_ne_bytes();
                // SAFETY: writes 8 bytes from a live buffer to an owned eventfd
                unsafe { libc::write(signal.as_raw_fd(), one.as_ptr().cast(), one.len()) };
            })?;
        Ok(Self(fd))
    }
}

/// What `wait_readable` woke up for.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Readiness {
    Readable,
    Stopped,
}

/// Sleeps until `fd` has data, hung up, or `stop` fired.
pub(super) fn wait_readable(fd: RawFd, stop: &StopFd) -> io::Result<Readiness> {
    let mut fds = [
        libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        },
        libc::pollfd {
            fd: stop.0.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        },
    ];
    loop {
        // SAFETY: `fds` is a live array of two initialised pollfd entries
        let result = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, -1) };
        if result < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        if fds[1].revents != 0 {
            return Ok(Readiness::Stopped);
        }
        if fds[0].revents != 0 {
            return Ok(Readiness::Readable);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wakes_up_for_data_and_for_a_stop() {
        let stop = StopToken::default();
        let stop_fd = StopFd::new(&stop).unwrap();
        let mut pipe = [0; 2];
        // SAFETY: `pipe` has room for the two descriptors
        assert_eq!(unsafe { libc::pipe(pipe.as_mut_ptr()) }, 0);
        // SAFETY: both descriptors are fresh and owned here
        let (read, write) =
            unsafe { (OwnedFd::from_raw_fd(pipe[0]), OwnedFd::from_raw_fd(pipe[1])) };
        // SAFETY: writes one byte from a live buffer
        unsafe { libc::write(write.as_raw_fd(), b"x".as_ptr().cast(), 1) };
        assert_eq!(
            wait_readable(read.as_raw_fd(), &stop_fd).unwrap(),
            Readiness::Readable
        );
        let mut byte = [0u8; 1];
        // SAFETY: reads one byte into a live buffer
        unsafe { libc::read(read.as_raw_fd(), byte.as_mut_ptr().cast(), 1) };
        stop.stop();
        assert_eq!(
            wait_readable(read.as_raw_fd(), &stop_fd).unwrap(),
            Readiness::Stopped
        );
    }
}
