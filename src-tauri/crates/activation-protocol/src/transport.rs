//! Per-session local IPC. No TCP listener or network fallback is used.
use std::io;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

use crate::{Request, Response, MAX_MESSAGE_BYTES};

const IO_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CLIENTS: usize = 32;

async fn read<T: serde::de::DeserializeOwned>(
    stream: &mut (impl AsyncRead + Unpin),
) -> io::Result<T> {
    let mut bytes = Vec::new();
    let mut reader = BufReader::new(stream.take((MAX_MESSAGE_BYTES + 1) as u64));
    reader.read_until(b'\n', &mut bytes).await?;
    if bytes.len() > MAX_MESSAGE_BYTES || bytes.last() != Some(&b'\n') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid or oversized protocol frame",
        ));
    }
    serde_json::from_slice(&bytes).map_err(io::Error::other)
}

async fn write(
    stream: &mut (impl AsyncWrite + Unpin),
    value: &impl serde::Serialize,
) -> io::Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    if bytes.len() >= MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Protocol message is too large",
        ));
    }
    bytes.push(b'\n');
    stream.write_all(&bytes).await?;
    stream.flush().await
}

async fn handle<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    handler: Arc<dyn Fn(Request) -> Response + Send + Sync>,
) {
    let response = match tokio::time::timeout(IO_TIMEOUT, read(&mut stream)).await {
        Ok(Ok(request)) => match tokio::task::spawn_blocking(move || handler(request)).await {
            Ok(response) => response,
            Err(error) => Response::error(error.to_string()),
        },
        Ok(Err(error)) => Response::coded_error("InvalidRequest", error.to_string()),
        Err(_) => return,
    };
    let _ = tokio::time::timeout(IO_TIMEOUT, write(&mut stream, &response)).await;
}

pub fn send(request: &Request) -> Result<Response, String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?
        .block_on(async {
            let mut stream = connect().await?;
            tokio::time::timeout(IO_TIMEOUT, async {
                write(&mut stream, request).await?;
                read(&mut stream).await
            })
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "Tyco request timed out"))?
        })
        .map_err(|error: io::Error| format!("Tyco local IPC is unavailable: {error}"))
}

pub fn serve(handler: impl Fn(Request) -> Response + Send + Sync + 'static) -> Result<(), String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?
        .block_on(serve_async(Arc::new(handler)))
        .map_err(|error| error.to_string())
}

#[cfg(unix)]
fn directory() -> io::Result<std::path::PathBuf> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let uid = unsafe { libc::geteuid() };
    let runtime = std::env::var_os("XDG_RUNTIME_DIR");
    let base = runtime
        .clone()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join(format!("tyco-{uid}")));
    if !base.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "IPC base directory must be absolute",
        ));
    }
    if runtime.is_none() {
        use std::os::unix::fs::DirBuilderExt;
        let result = std::fs::DirBuilder::new().mode(0o700).create(&base);
        if let Err(error) = result {
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
        }
    }
    let metadata = std::fs::symlink_metadata(&base)?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "IPC base directory must be owned by the current user with mode 0700",
        ));
    }
    let directory = base.join("tyco-control");
    let mut builder = std::fs::DirBuilder::new();
    use std::os::unix::fs::DirBuilderExt;
    builder.mode(0o700);
    if let Err(error) = builder.create(&directory) {
        if error.kind() != io::ErrorKind::AlreadyExists {
            return Err(error);
        }
    }
    let metadata = std::fs::symlink_metadata(&directory)?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "IPC directory must be owned by the current user with mode 0700",
        ));
    }
    Ok(directory)
}

#[cfg(unix)]
async fn connect() -> io::Result<tokio::net::UnixStream> {
    let stream = tokio::net::UnixStream::connect(directory()?.join("control.sock")).await?;
    if stream.peer_cred()?.uid() != unsafe { libc::geteuid() } {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "IPC server belongs to another user",
        ));
    }
    Ok(stream)
}

#[cfg(unix)]
async fn serve_async(handler: Arc<dyn Fn(Request) -> Response + Send + Sync>) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let directory = directory()?;
    // The lock serializes stale-socket removal and stays held for the server lifetime.
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(directory.join("control.lock"))?;
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            "Tyco IPC server is already running",
        ));
    }
    let path = directory.join("control.sock");
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let listener = tokio::net::UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    let clients = Arc::new(tokio::sync::Semaphore::new(MAX_CLIENTS));
    loop {
        let (stream, _) = listener.accept().await?;
        if stream.peer_cred()?.uid() != unsafe { libc::geteuid() } {
            continue;
        }
        let Ok(permit) = clients.clone().try_acquire_owned() else {
            continue;
        };
        let handler = handler.clone();
        tokio::spawn(async move {
            let _permit = permit;
            handle(stream, handler).await;
        });
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenLogonSid, SECURITY_ATTRIBUTES, TOKEN_GROUPS, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    pub struct Security {
        descriptor: *mut std::ffi::c_void,
        pub name: String,
    }
    impl Security {
        pub fn new() -> io::Result<Self> {
            unsafe {
                let mut token = std::ptr::null_mut();
                if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                    return Err(io::Error::last_os_error());
                }
                let result = (|| {
                    let mut size = 0;
                    GetTokenInformation(token, TokenLogonSid, std::ptr::null_mut(), 0, &mut size);
                    // A usize allocation provides alignment for TOKEN_GROUPS.
                    let mut buffer =
                        vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
                    if GetTokenInformation(
                        token,
                        TokenLogonSid,
                        buffer.as_mut_ptr().cast(),
                        size,
                        &mut size,
                    ) == 0
                    {
                        return Err(io::Error::last_os_error());
                    }
                    let groups = &*buffer.as_ptr().cast::<TOKEN_GROUPS>();
                    if groups.GroupCount != 1 {
                        return Err(io::Error::other("Missing logon SID"));
                    }
                    let mut sid = std::ptr::null_mut();
                    if ConvertSidToStringSidW(groups.Groups[0].Sid, &mut sid) == 0 {
                        return Err(io::Error::last_os_error());
                    }
                    let mut len = 0;
                    while *sid.add(len) != 0 {
                        len += 1;
                    }
                    let sid_text = String::from_utf16_lossy(std::slice::from_raw_parts(sid, len));
                    LocalFree(sid.cast());
                    // Only this logon may open the pipe. Remote clients are also rejected by the transport.
                    let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid_text})")
                        .encode_utf16()
                        .chain(Some(0))
                        .collect();
                    let mut descriptor = std::ptr::null_mut();
                    if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                        sddl.as_ptr(),
                        1,
                        &mut descriptor,
                        std::ptr::null_mut(),
                    ) == 0
                    {
                        return Err(io::Error::last_os_error());
                    }
                    Ok(Self {
                        descriptor,
                        name: format!(r"\\.\pipe\tyco-control-{sid_text}"),
                    })
                })();
                CloseHandle(token);
                result
            }
        }
        pub fn attributes(&self) -> SECURITY_ATTRIBUTES {
            SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: self.descriptor,
                bInheritHandle: 0,
            }
        }
    }
    impl Drop for Security {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.descriptor);
            }
        }
    }
}

#[cfg(windows)]
async fn connect() -> io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    use tokio::net::windows::named_pipe::ClientOptions;
    let security = windows::Security::new()?;
    for _ in 0..100 {
        match ClientOptions::new().open(&security.name) {
            Ok(client) => return Ok(client),
            Err(error) if error.raw_os_error() == Some(231) => {
                tokio::time::sleep(Duration::from_millis(20)).await
            }
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(io::ErrorKind::TimedOut, "Tyco pipe is busy"))
}

#[cfg(windows)]
async fn serve_async(handler: Arc<dyn Fn(Request) -> Response + Send + Sync>) -> io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let security = windows::Security::new()?;
    let mut options = ServerOptions::new();
    options
        .reject_remote_clients(true)
        .first_pipe_instance(true);
    let create = |options: &ServerOptions| unsafe {
        options.create_with_security_attributes_raw(
            &security.name,
            &security.attributes() as *const _ as *mut _,
        )
    };
    let mut server = create(&options)?;
    options.first_pipe_instance(false);
    let clients = Arc::new(tokio::sync::Semaphore::new(MAX_CLIENTS));
    loop {
        let permit = clients
            .clone()
            .acquire_owned()
            .await
            .map_err(io::Error::other)?;
        server.connect().await?;
        let next = create(&options)?;
        let connected = std::mem::replace(&mut server, next);
        let handler = handler.clone();
        tokio::spawn(async move {
            let _permit = permit;
            handle(connected, handler).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_preserves_unicode_and_rejects_incomplete_frames() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let (mut client, mut server) = tokio::io::duplex(2048);
                let request = Request::Run {
                    request: crate::RunRequest {
                        target: "test".into(),
                        text: Some("Hello\n\u{1f642}\n".into()),
                        ..Default::default()
                    },
                };
                write(&mut client, &request).await.unwrap();
                assert_eq!(read::<Request>(&mut server).await.unwrap(), request);
                client.write_all(b"{}").await.unwrap();
                drop(client);
                assert!(read::<Request>(&mut server).await.is_err());
            });
    }
}
