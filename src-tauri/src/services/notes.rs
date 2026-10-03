use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::errors::AppError;

/// How many numbered variants of a file name are tried before giving up.
const MAX_NAME_ATTEMPTS: u32 = 1000;

/// Writes `text` into a new file inside `dir` and returns the path of that file.
///
/// The directory is created when it does not exist. An existing file is never
/// overwritten: when `file_name` is taken, a numeric suffix is appended to its
/// stem (`note.md` becomes `note-1.md`, `note-2.md` and so on).
pub fn save_note(dir: &str, file_name: &str, text: &str) -> Result<PathBuf, AppError> {
    let dir = resolve_notes_dir(dir, home_dir().as_deref())?;
    validate_file_name(file_name)?;

    fs::create_dir_all(&dir)?;

    for attempt in 0..MAX_NAME_ATTEMPTS {
        let path = dir.join(numbered_file_name(file_name, attempt));

        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(text.as_bytes())?;
                return Ok(path);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }

    Err(AppError::Message(format!(
        "Failed to find a free file name for `{file_name}` in `{}`",
        dir.display()
    )))
}

/// Appends `text` to an existing file inside `dir`, or creates it if missing.
///
/// If the existing file is non-empty and does not end with a newline, a newline
/// is inserted before appending `text`.
pub fn append_note(dir: &str, file_name: &str, text: &str) -> Result<PathBuf, AppError> {
    let dir = resolve_notes_dir(dir, home_dir().as_deref())?;
    validate_file_name(file_name)?;

    fs::create_dir_all(&dir)?;

    let path = dir.join(file_name);

    let needs_newline = if path.exists() {
        let meta = fs::metadata(&path)?;
        if meta.len() > 0 {
            let mut file = fs::File::open(&path)?;
            file.seek(SeekFrom::End(-1))?;
            let mut byte = [0u8; 1];
            file.read_exact(&mut byte)?;
            byte[0] != b'\n'
        } else {
            false
        }
    } else {
        false
    };

    let mut file = OpenOptions::new().create(true).append(true).open(&path)?;

    if needs_newline {
        file.write_all(b"\n")?;
    }
    file.write_all(text.as_bytes())?;

    Ok(path)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Expands a leading `~` and requires the result to be an absolute path, so that
/// notes never land relative to whatever the working directory happens to be.
fn resolve_notes_dir(dir: &str, home: Option<&Path>) -> Result<PathBuf, AppError> {
    let dir = dir.trim();

    if dir.is_empty() {
        return Err(AppError::Message(String::from(
            "Notes directory is not configured",
        )));
    }

    let resolved = if dir == "~" {
        home_required(home)?.to_path_buf()
    } else if let Some(rest) = dir.strip_prefix("~/") {
        home_required(home)?.join(rest)
    } else {
        PathBuf::from(dir)
    };

    if !resolved.is_absolute() {
        return Err(AppError::Message(format!(
            "Notes directory must be an absolute path: `{dir}`"
        )));
    }

    Ok(resolved)
}

fn home_required(home: Option<&Path>) -> Result<&Path, AppError> {
    home.ok_or_else(|| AppError::Message(String::from("Home directory is not known")))
}

fn validate_file_name(file_name: &str) -> Result<(), AppError> {
    let is_invalid = file_name.trim().is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains(['/', '\\', '\0']);

    if is_invalid {
        return Err(AppError::Message(format!(
            "Invalid note file name: `{file_name}`"
        )));
    }

    Ok(())
}

fn numbered_file_name(file_name: &str, attempt: u32) -> String {
    if attempt == 0 {
        return file_name.to_string();
    }

    match file_name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => format!("{stem}-{attempt}.{extension}"),
        _ => format!("{file_name}-{attempt}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Returns a unique, not yet existing path under the system temp dir.
    fn temp_path(label: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);

        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "tyco-notes-test-{}-{}-{}",
            label,
            std::process::id(),
            unique
        ));

        let _ = fs::remove_dir_all(&dir);

        dir
    }

    #[test]
    fn creates_missing_directory_and_writes_text() {
        let dir = temp_path("create").join("nested");

        let path = save_note(dir.to_str().unwrap(), "note.md", "hello").unwrap();

        assert_eq!(path, dir.join("note.md"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn never_overwrites_existing_notes() {
        let dir = temp_path("collision");
        let dir_str = dir.to_str().unwrap();

        let first = save_note(dir_str, "note.md", "first").unwrap();
        let second = save_note(dir_str, "note.md", "second").unwrap();
        let third = save_note(dir_str, "note.md", "third").unwrap();

        assert_eq!(first, dir.join("note.md"));
        assert_eq!(second, dir.join("note-1.md"));
        assert_eq!(third, dir.join("note-2.md"));
        assert_eq!(fs::read_to_string(&first).unwrap(), "first");
        assert_eq!(fs::read_to_string(&second).unwrap(), "second");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_file_names_that_escape_the_directory() {
        let dir = temp_path("invalid-name");
        let dir_str = dir.to_str().unwrap();

        for name in ["", "  ", ".", "..", "../x.md", "a/b.md", "a\\b.md"] {
            assert!(save_note(dir_str, name, "text").is_err(), "{name:?}");
        }

        assert!(!dir.exists());
    }

    #[test]
    fn resolves_home_relative_directories() {
        let home = Path::new("/home/user");

        assert_eq!(
            resolve_notes_dir("~", Some(home)).unwrap(),
            PathBuf::from("/home/user")
        );
        assert_eq!(
            resolve_notes_dir(" ~/notes ", Some(home)).unwrap(),
            PathBuf::from("/home/user/notes")
        );
        assert!(resolve_notes_dir("~/notes", None).is_err());
    }

    #[test]
    fn rejects_empty_and_relative_directories() {
        let home = Path::new("/home/user");

        assert!(resolve_notes_dir("", Some(home)).is_err());
        assert!(resolve_notes_dir("   ", Some(home)).is_err());
        assert!(resolve_notes_dir("notes", Some(home)).is_err());
        assert!(resolve_notes_dir("~user/notes", Some(home)).is_err());
    }

    #[test]
    fn numbers_file_names_before_the_extension() {
        assert_eq!(numbered_file_name("note.md", 0), "note.md");
        assert_eq!(numbered_file_name("note.md", 3), "note-3.md");
        assert_eq!(numbered_file_name("note", 1), "note-1");
        assert_eq!(numbered_file_name(".hidden", 1), ".hidden-1");
    }

    #[test]
    fn appends_text_to_new_and_existing_files() {
        let dir = temp_path("append");
        let dir_str = dir.to_str().unwrap();

        // When file doesn't exist, it is created
        let path1 = append_note(dir_str, "daily.md", "- first entry\n").unwrap();
        assert_eq!(path1, dir.join("daily.md"));
        assert_eq!(fs::read_to_string(&path1).unwrap(), "- first entry\n");

        // When file exists and ends with \n, text is appended without extra newline
        let path2 = append_note(dir_str, "daily.md", "- second entry\n").unwrap();
        assert_eq!(path2, path1);
        assert_eq!(
            fs::read_to_string(&path1).unwrap(),
            "- first entry\n- second entry\n"
        );

        // When file exists but does NOT end with newline, a newline is inserted
        fs::write(&path1, "no newline at end").unwrap();
        let path3 = append_note(dir_str, "daily.md", "appended line").unwrap();
        assert_eq!(path3, path1);
        assert_eq!(
            fs::read_to_string(&path1).unwrap(),
            "no newline at end\nappended line"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
