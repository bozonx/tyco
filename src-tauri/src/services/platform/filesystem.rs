//! Platform-specific durability for descriptor-relative filesystem operations.
use cap_std::fs::{Dir, File, OpenOptions};
use std::io;
use std::path::Path;

pub(crate) fn sync_directory(dir: &Dir) -> io::Result<()> {
    #[cfg(unix)]
    // Directory capabilities can use O_PATH, which cannot be synced. Reopen
    // the same directory for reading without resolving its ambient pathname.
    dir.open(".")?.sync_all()?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

/// Do not block opening a FIFO that replaced a validated regular file.
pub(crate) fn open_read(dir: &Dir, path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    dir.open_with(path, &options)
}

/// Atomically move a single entry between pinned parents, refusing to replace
/// any destination, including one created after the caller's existence check.
pub(crate) fn rename_no_replace(
    source: &Dir,
    source_name: &std::ffi::OsStr,
    destination: &Dir,
    destination_name: &std::ffi::OsStr,
) -> io::Result<()> {
    for name in [source_name, destination_name] {
        let mut components = Path::new(name).components();
        if !matches!(components.next(), Some(std::path::Component::Normal(_)))
            || components.next().is_some()
            || name.as_encoded_bytes().contains(&0)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Expected a single file name",
            ));
        }
    }
    rename_entry_no_replace(source, source_name, destination, destination_name)
}

#[cfg(unix)]
fn rename_entry_no_replace(
    source: &Dir,
    source_name: &std::ffi::OsStr,
    destination: &Dir,
    destination_name: &std::ffi::OsStr,
) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStrExt;
    let source_name = CString::new(source_name.as_bytes())?;
    let destination_name = CString::new(destination_name.as_bytes())?;
    // SAFETY: both descriptors remain open and both names are NUL-terminated
    // single components. The kernel performs the existence check and rename.
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            source.as_raw_fd(),
            source_name.as_ptr(),
            destination.as_raw_fd(),
            destination_name.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            source.as_raw_fd(),
            source_name.as_ptr(),
            destination.as_raw_fd(),
            destination_name.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_entry_no_replace(
    source: &Dir,
    source_name: &std::ffi::OsStr,
    destination: &Dir,
    destination_name: &std::ffi::OsStr,
) -> io::Result<()> {
    use std::os::windows::{ffi::OsStrExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, MoveFileExW};

    fn entry_path(dir: &Dir, name: &std::ffi::OsStr) -> io::Result<Vec<u16>> {
        let mut path = vec![0u16; 256];
        loop {
            // SAFETY: the directory handle stays live and the output buffer
            // has the advertised capacity. Windows reports the required size.
            let length = unsafe {
                GetFinalPathNameByHandleW(
                    dir.as_raw_handle(),
                    path.as_mut_ptr(),
                    path.len() as u32,
                    0,
                )
            };
            if length == 0 {
                return Err(io::Error::last_os_error());
            }
            if length as usize >= path.len() {
                path.resize(length as usize + 1, 0);
                continue;
            }
            path.truncate(length as usize);
            if path.last() != Some(&(b'\\' as u16)) {
                path.push(b'\\' as u16);
            }
            path.extend(name.encode_wide());
            path.push(0);
            return Ok(path);
        }
    }
    let source_path = entry_path(source, source_name)?;
    let destination_path = entry_path(destination, destination_name)?;
    // cap-std directory handles exclude FILE_SHARE_DELETE on Windows, pinning
    // both parents while their paths are used. No REPLACE_EXISTING flag is set.
    // SAFETY: both UTF-16 paths are NUL-terminated and both parents remain open.
    let result = unsafe { MoveFileExW(source_path.as_ptr(), destination_path.as_ptr(), 0) };
    if result != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

pub(crate) fn rename_path_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    let parent = |path: &Path| {
        Dir::open_ambient_dir(
            path.parent().unwrap_or(Path::new(".")),
            cap_std::ambient_authority(),
        )
    };
    fn name(path: &Path) -> io::Result<&std::ffi::OsStr> {
        path.file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Expected a file name"))
    }
    rename_no_replace(
        &parent(source)?,
        name(source)?,
        &parent(destination)?,
        name(destination)?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;
    use std::ffi::OsStr;
    use std::fs;

    #[test]
    fn publication_never_replaces_files_or_directories() {
        let root = TestDir::new("rename-no-replace");
        let dir = Dir::open_ambient_dir(&root, cap_std::ambient_authority()).unwrap();
        fs::write(root.join("source"), "source").unwrap();
        fs::write(root.join("destination"), "concurrent writer").unwrap();
        let result = rename_no_replace(&dir, OsStr::new("source"), &dir, OsStr::new("destination"));
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            fs::read_to_string(root.join("destination")).unwrap(),
            "concurrent writer"
        );
        assert_eq!(fs::read_to_string(root.join("source")).unwrap(), "source");
        fs::create_dir(root.join("source-dir")).unwrap();
        fs::create_dir(root.join("destination-dir")).unwrap();
        assert!(rename_no_replace(
            &dir,
            OsStr::new("source-dir"),
            &dir,
            OsStr::new("destination-dir")
        )
        .is_err());
        assert!(root.join("source-dir").is_dir());
    }

    #[test]
    fn competing_moves_preserve_the_losing_source() {
        let root = TestDir::new("rename-no-replace-concurrent");
        fs::write(root.join("first"), "first").unwrap();
        fs::write(root.join("second"), "second").unwrap();
        let barrier = std::sync::Barrier::new(2);
        let results = std::thread::scope(|scope| {
            let run = |name: &str| {
                barrier.wait();
                rename_path_no_replace(&root.join(name), &root.join("winner"))
            };
            let first = scope.spawn(move || run("first"));
            let second = scope.spawn(move || run("second"));
            (first.join().unwrap(), second.join().unwrap())
        });
        assert_ne!(results.0.is_ok(), results.1.is_ok());
        let winner = fs::read_to_string(root.join("winner")).unwrap();
        let loser = if winner == "first" { "second" } else { "first" };
        assert_eq!(fs::read_to_string(root.join(loser)).unwrap(), loser);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
    }

    #[test]
    fn publication_moves_files_and_folders_to_unoccupied_names() {
        let root = TestDir::new("rename-no-replace-success");
        fs::create_dir(root.join("source")).unwrap();
        fs::write(root.join("source/data"), "source").unwrap();
        rename_path_no_replace(&root.join("source"), &root.join("destination")).unwrap();
        assert!(!root.join("source").exists());
        assert_eq!(
            fs::read_to_string(root.join("destination/data")).unwrap(),
            "source"
        );
    }
}
