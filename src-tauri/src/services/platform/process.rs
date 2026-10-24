//! Bounded execution of desktop utilities and cancellable output readers.
use std::io::{self, Read};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MAX_UTILITY_OUTPUT: u64 = 16 * 1024 * 1024;
/// How often an idle pipe reader checks for output and for a stop.
const PIPE_POLL_INTERVAL: Duration = Duration::from_millis(5);
/// What a pipe reader takes in one read.
const PIPE_CHUNK_BYTES: usize = 8192;

pub fn command(program: &str, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    command
}

/// Limits input delivery, process lifetime and pipe draining with one deadline.
pub fn run(
    command: Command,
    input: Option<&[u8]>,
    timeout: Duration,
) -> io::Result<(ExitStatus, Vec<u8>)> {
    run_with_output(command, input, timeout, true)
}

pub fn status(command: Command, input: Option<&[u8]>, timeout: Duration) -> io::Result<ExitStatus> {
    run_with_output(command, input, timeout, false).map(|(status, _)| status)
}

fn run_with_output(
    mut command: Command,
    input: Option<&[u8]>,
    timeout: Duration,
    capture: bool,
) -> io::Result<(ExitStatus, Vec<u8>)> {
    if tokio::runtime::Handle::try_current().is_ok() {
        return thread::scope(|scope| {
            scope
                .spawn(move || run_with_output(command, input, timeout, capture))
                .join()
                .map_err(|_| io::Error::other("Process worker panicked"))?
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    hide_console_window(&mut command);
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(if capture {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stderr(Stdio::null());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let mut command = tokio::process::Command::from(command);
        let mut child = command.kill_on_drop(true).spawn()?;
        let id = child.id();
        let mut stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let operation = async {
            let write = async {
                if let (Some(stdin), Some(input)) = (&mut stdin, input) {
                    stdin.write_all(input).await?;
                }
                drop(stdin.take());
                Ok::<_, io::Error>(())
            };
            let read = async {
                let mut bytes = Vec::new();
                if let Some(stdout) = stdout {
                    stdout
                        .take(MAX_UTILITY_OUTPUT + 1)
                        .read_to_end(&mut bytes)
                        .await?;
                }
                if bytes.len() as u64 > MAX_UTILITY_OUTPUT {
                    return Err(io::Error::other("Process output exceeds the size limit"));
                }
                Ok(bytes)
            };
            let (_, bytes, status) = tokio::try_join!(write, read, child.wait())?;
            Ok((status, bytes))
        };
        let result = match tokio::time::timeout(timeout, operation).await {
            Ok(result) => result,
            Err(_) => Err(io::Error::new(io::ErrorKind::TimedOut, "Process timed out")),
        };
        if result.is_err() {
            kill_group(id);
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        result
    })
}

fn kill_group(id: Option<u32>) {
    #[cfg(unix)]
    if let Some(group) = id.and_then(|id| i32::try_from(id).ok()) {
        // SAFETY: the child was spawned in its own process group.
        unsafe {
            libc::kill(-group, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    if let Some(id) = id {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &id.to_string(), "/T", "/F"]);
        hide_console_window(&mut command);
        let _ = command.status();
    }
    #[cfg(not(any(unix, windows)))]
    let _ = id;
}

/// Terminates a process tree created in its own process group by this module
/// or by the platform shell. The owner must still reap the direct child.
pub fn kill_tree(child: &mut std::process::Child) {
    kill_group(Some(child.id()));
    let _ = child.kill();
}

pub trait PollablePipe: Read + Send + 'static {
    fn prepare(&self) -> io::Result<()>;
    fn is_ready(&self) -> io::Result<bool>;
}

#[cfg(unix)]
impl<T: Read + Send + std::os::fd::AsRawFd + 'static> PollablePipe for T {
    fn prepare(&self) -> io::Result<()> {
        // SAFETY: the owned pipe descriptor remains valid during these calls.
        let flags = unsafe { libc::fcntl(self.as_raw_fd(), libc::F_GETFL) };
        if flags < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: preserves existing flags and makes reads cancellable.
        if unsafe { libc::fcntl(self.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    fn is_ready(&self) -> io::Result<bool> {
        Ok(true)
    }
}

#[cfg(windows)]
impl<T: Read + Send + std::os::windows::io::AsRawHandle + 'static> PollablePipe for T {
    fn prepare(&self) -> io::Result<()> {
        Ok(())
    }
    fn is_ready(&self) -> io::Result<bool> {
        use windows_sys::Win32::System::Pipes::PeekNamedPipe;
        let mut available = 0;
        // SAFETY: the owned handle is a readable pipe; only byte count is requested.
        let success = unsafe {
            PeekNamedPipe(
                self.as_raw_handle(),
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                &mut available,
                std::ptr::null_mut(),
            )
        };
        if success == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(available > 0)
    }
}

/// Owns a reader thread and joins it on every exit path.
/// Pipes have one reader; Windows readiness checks therefore cannot race with
/// another consumer before the read.
pub struct PipeReader {
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl PipeReader {
    pub fn start(
        mut pipe: impl PollablePipe,
        mut consume: impl FnMut(&[u8]) + Send + 'static,
    ) -> io::Result<Self> {
        pipe.prepare()?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = thread::spawn(move || {
            let mut chunk = [0; PIPE_CHUNK_BYTES];
            while !flag.load(Ordering::Relaxed) {
                match pipe.is_ready() {
                    Ok(false) => {
                        thread::sleep(PIPE_POLL_INTERVAL);
                        continue;
                    }
                    Err(_) => break,
                    Ok(true) => {}
                }
                match pipe.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(size) => consume(&chunk[..size]),
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(PIPE_POLL_INTERVAL)
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            stop,
            thread: Some(thread),
        })
    }
    pub fn drain_until(&self, deadline: Instant) {
        while self
            .thread
            .as_ref()
            .is_some_and(|thread| !thread.is_finished())
            && Instant::now() < deadline
        {
            thread::sleep(PIPE_POLL_INTERVAL);
        }
    }
}
impl Drop for PipeReader {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// A console program started from a GUI app flashes a window on Windows.
pub fn hide_console_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn integration_synchronous_utility_can_run_inside_an_async_caller() {
        let status = status(
            command("sh", &["-c", "exit 0"]),
            None,
            Duration::from_secs(1),
        )
        .unwrap();
        assert!(status.success());
    }
    #[cfg(unix)]
    #[test]
    fn integration_deadline_includes_descendants_holding_stdout() {
        let started = Instant::now();
        let result = run(
            command("sh", &["-c", "sleep 30 & exit 0"]),
            None,
            Duration::from_millis(100),
        );
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
    #[cfg(unix)]
    #[test]
    fn integration_deadline_includes_blocked_input() {
        let started = Instant::now();
        let input = vec![0; 1024 * 1024];
        let result = run(
            command("sh", &["-c", "sleep 30"]),
            Some(&input),
            Duration::from_millis(100),
        );
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
    #[cfg(unix)]
    #[test]
    fn integration_dropping_reader_closes_a_pipe_held_by_a_descendant() {
        let mut child = Command::new("sh")
            .args(["-c", "sleep 1 & exit 0"])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let reader = PipeReader::start(child.stdout.take().unwrap(), |_| {}).unwrap();
        child.wait().unwrap();
        let started = Instant::now();
        drop(reader);
        assert!(started.elapsed() < Duration::from_millis(500));
    }
}
