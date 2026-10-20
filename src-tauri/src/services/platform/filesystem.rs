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
