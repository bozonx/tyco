//! Mutations relative to open directory handles, never re-opened absolute paths.
use std::ffi::{OsStr, OsString};
use std::io::{self, Read, Write};

use cap_std::fs::{Dir, File, OpenOptions};

use crate::errors::AppError;

pub(super) struct TemporaryFile<'a> {
    dir: &'a Dir,
    name: OsString,
}

impl<'a> TemporaryFile<'a> {
    fn create(dir: &'a Dir) -> io::Result<(Self, File)> {
        loop {
            let name = OsString::from(format!(
                ".tyco-tmp-{}",
                crate::services::atomic_file::unique_file_suffix()
            ));
            match dir.open_with(&name, OpenOptions::new().write(true).create_new(true)) {
                Ok(file) => return Ok((Self { dir, name }, file)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
    }
}

impl Drop for TemporaryFile<'_> {
    fn drop(&mut self) {
        if let Err(error) = self.dir.remove_file(&self.name) {
            if error.kind() != io::ErrorKind::NotFound {
                log::warn!("Could not remove temporary file {:?}: {error}", self.name);
            }
        }
    }
}

/// A replacement is published only once all bytes have been written and synced.
/// With `replace = false`, publication fails if the name is already occupied.
pub(super) fn write_file(dir: &Dir, name: &OsStr, bytes: &[u8], replace: bool) -> io::Result<()> {
    let permissions = if replace {
        match dir.metadata(name) {
            Ok(metadata) => Some(metadata.permissions()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        }
    } else {
        None
    };
    let (temporary, mut file) = TemporaryFile::create(dir)?;
    file.write_all(bytes)?;
    if let Some(permissions) = permissions {
        file.set_permissions(permissions)?;
    }
    file.sync_all()?;
    drop(file);
    if replace {
        dir.rename(&temporary.name, dir, name)?;
    } else {
        // Unlike rename, hard_link never replaces a concurrently created name.
        dir.hard_link(&temporary.name, dir, name)?;
    }
    drop(temporary);
    crate::services::platform::filesystem::sync_directory(dir)
}

/// Copies across filesystems without exposing incomplete destination bytes.
/// If removing the source fails, roll back the published destination.
pub(super) fn copy_move(
    source: &Dir,
    source_name: &OsStr,
    destination: &Dir,
    destination_name: &OsStr,
) -> Result<(), AppError> {
    let input = crate::services::platform::filesystem::open_read(source, source_name.as_ref())?;
    let metadata = input.metadata()?;
    if !metadata.is_file() {
        return Err(AppError::InvalidInput(
            "Only regular files can be copied when moving across filesystems".into(),
        ));
    }
    copy_move_with(
        input,
        metadata.permissions(),
        destination,
        destination_name,
        || source.remove_file(source_name),
    )?;
    crate::services::platform::filesystem::sync_directory(source)?;
    Ok(())
}

fn copy_move_with(
    mut input: impl Read,
    permissions: cap_std::fs::Permissions,
    destination: &Dir,
    destination_name: &OsStr,
    remove_source: impl FnOnce() -> io::Result<()>,
) -> Result<(), AppError> {
    let (temporary, mut output) = TemporaryFile::create(destination)?;
    io::copy(&mut input, &mut output)?;
    output.set_permissions(permissions)?;
    output.sync_all()?;
    drop(output);
    destination.hard_link(&temporary.name, destination, destination_name)?;
    if let Err(error) = crate::services::platform::filesystem::sync_directory(destination)
        .and_then(|()| remove_source())
    {
        if let Err(rollback) = destination.remove_file(destination_name) {
            return Err(AppError::Failed(format!(
                "Move failed: {error}; the source is retained, but destination {:?} could not be rolled back: {rollback}",
                destination_name
            )));
        }
        crate::services::platform::filesystem::sync_directory(destination)?;
        return Err(error.into());
    }
    drop(temporary);
    crate::services::platform::filesystem::sync_directory(destination)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;
    use std::fs;
    use std::io::Cursor;

    fn open_dir(path: &std::path::Path) -> Dir {
        Dir::open_ambient_dir(path, cap_std::ambient_authority()).unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn replacements_preserve_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let directory = TestDir::new("scoped-write-permissions");
        fs::write(directory.join("file"), "old").unwrap();
        fs::set_permissions(directory.join("file"), fs::Permissions::from_mode(0o640)).unwrap();
        write_file(&open_dir(&directory), OsStr::new("file"), b"new", true).unwrap();
        assert_eq!(fs::read_to_string(directory.join("file")).unwrap(), "new");
        assert_eq!(
            fs::metadata(directory.join("file"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
    }

    #[test]
    fn an_incomplete_copy_leaves_no_destination_or_temporary_file() {
        struct BrokenReader(bool);
        impl Read for BrokenReader {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                if self.0 {
                    return Err(io::Error::other("Injected read failure"));
                }
                self.0 = true;
                buffer[..3].copy_from_slice(b"new");
                Ok(3)
            }
        }
        let directory = TestDir::new("move-copy-failure");
        let destination = open_dir(&directory);
        fs::write(directory.join("source"), "original").unwrap();
        let permissions = destination.metadata("source").unwrap().permissions();
        let error = copy_move_with(
            BrokenReader(false),
            permissions,
            &destination,
            OsStr::new("target"),
            || panic!("A failed copy must not remove the source"),
        );
        assert!(error.is_err());
        assert_eq!(
            fs::read_to_string(directory.join("source")).unwrap(),
            "original"
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    }

    #[test]
    fn a_failed_source_removal_rolls_back_the_destination() {
        let directory = TestDir::new("move-remove-failure");
        fs::write(directory.join("source"), "original").unwrap();
        let destination = open_dir(&directory);
        let permissions = destination.metadata("source").unwrap().permissions();
        let error = copy_move_with(
            Cursor::new(b"original"),
            permissions,
            &destination,
            OsStr::new("target"),
            || {
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Injected removal failure",
                ))
            },
        );
        assert!(error.is_err());
        assert_eq!(
            fs::read_to_string(directory.join("source")).unwrap(),
            "original"
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    }

    #[test]
    fn publication_never_overwrites_an_existing_destination() {
        let directory = TestDir::new("move-no-clobber");
        fs::write(directory.join("target"), "existing").unwrap();
        let destination = open_dir(&directory);
        let permissions = destination.metadata("target").unwrap().permissions();
        assert!(copy_move_with(
            Cursor::new(b"new"),
            permissions,
            &destination,
            OsStr::new("target"),
            || { panic!("A conflicting destination must not remove the source") }
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(directory.join("target")).unwrap(),
            "existing"
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        assert_eq!(
            write_file(&destination, OsStr::new("target"), b"upload", false)
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(
            fs::read_to_string(directory.join("target")).unwrap(),
            "existing"
        );
    }

    #[test]
    fn a_completed_copy_move_preserves_bytes_and_removes_the_source() {
        let directory = TestDir::new("move-copy-success");
        fs::write(directory.join("source"), "original").unwrap();
        let dir = open_dir(&directory);
        copy_move(&dir, OsStr::new("source"), &dir, OsStr::new("target")).unwrap();
        assert_eq!(
            fs::read_to_string(directory.join("target")).unwrap(),
            "original"
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    }
}
