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
fn save_note(dir: &str, file_name: &str, text: &str) -> Result<PathBuf, AppError> {
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
fn append_note(dir: &str, file_name: &str, text: &str) -> Result<PathBuf, AppError> {
    let dir = resolve_notes_dir(dir, home_dir().as_deref())?;
    validate_file_name(file_name)?;

    fs::create_dir_all(&dir)?;

    let path = dir.join(file_name);

    let mut options = OpenOptions::new();
    options.read(true).create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options.open(&path)?;
    if !file.metadata()?.is_file() {
        return Err(AppError::InvalidInput(
            "Notes require a regular file".into(),
        ));
    }
    file.lock()?;
    let needs_newline = {
        let meta = file.metadata()?;
        if meta.len() > 0 {
            file.seek(SeekFrom::End(-1))?;
            let mut byte = [0u8; 1];
            file.read_exact(&mut byte)?;
            byte[0] != b'\n'
        } else {
            false
        }
    };

    if needs_newline {
        file.write_all(b"\n")?;
    }
    file.write_all(text.as_bytes())?;

    Ok(path)
}

/// A plugin may write only under a user-approved root, including new subfolders.
pub fn write_scoped_note(
    roots: &[String],
    dir: &str,
    file_name: &str,
    text: &str,
    append: bool,
) -> Result<PathBuf, AppError> {
    validate_file_name(file_name)?;
    if text.len() > 8 * 1024 * 1024 {
        return Err(AppError::Message(
            "Plugin note exceeds the size limit".into(),
        ));
    }
    let requested = resolve_notes_dir(dir, home_dir().as_deref())?;
    if requested
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(AppError::InvalidInput(
            "Plugin notes cannot traverse parent directories".into(),
        ));
    }
    for root in roots {
        let root = resolve_notes_dir(root, home_dir().as_deref())?;
        if root
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            continue;
        }
        let Ok(relative) = requested.strip_prefix(&root) else {
            continue;
        };
        fs::create_dir_all(&root)?;
        let canonical_root = root.canonicalize()?;
        let mut target = canonical_root.clone();
        for component in relative.components() {
            if let std::path::Component::Normal(name) = component {
                target.push(name);
                match fs::symlink_metadata(&target) {
                    Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                        return Err(AppError::InvalidInput(
                            "Plugin notes cannot follow directory symlinks".into(),
                        ));
                    }
                    Ok(_) => {}
                    Err(error) if error.kind() == ErrorKind::NotFound => fs::create_dir(&target)?,
                    Err(error) => return Err(error.into()),
                }
                if !target.canonicalize()?.starts_with(&canonical_root) {
                    return Err(AppError::InvalidInput(
                        "Plugin note directory is outside the approved root".into(),
                    ));
                }
            }
        }
        let file = target.join(file_name);
        if fs::symlink_metadata(&file).is_ok_and(|metadata| !metadata.file_type().is_file()) {
            return Err(AppError::InvalidInput(
                "Plugin notes require a regular file".into(),
            ));
        }
        let target = target
            .to_str()
            .ok_or_else(|| AppError::InvalidInput("Invalid notes directory encoding".into()))?;
        return if append {
            append_note(target, file_name, text)
        } else {
            save_note(target, file_name, text)
        };
    }
    Err(AppError::InvalidInput(
        "Plugin note directory is outside the approved roots".into(),
    ))
}

fn home_dir() -> Option<PathBuf> {
    crate::services::platform::shell::home_dir()
}

/// Expands a leading `~` and requires the result to be an absolute path, so that
/// notes never land relative to whatever the working directory happens to be.
fn resolve_notes_dir(dir: &str, home: Option<&Path>) -> Result<PathBuf, AppError> {
    let dir = dir.trim();

    if dir.is_empty() {
        return Err(AppError::ServiceUnavailable(String::from(
            "Notes directory is not configured",
        )));
    }

    let resolved = crate::services::platform::shell::expand_home(dir, home)
        .ok_or_else(|| AppError::Message(String::from("Home directory is not known")))?;

    if !resolved.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "Notes directory must be an absolute path: `{dir}`"
        )));
    }

    Ok(resolved)
}

fn validate_file_name(file_name: &str) -> Result<(), AppError> {
    let is_invalid = file_name.trim().is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains(['/', '\\', '\0'])
        || (cfg!(windows) && !is_windows_file_name(file_name));

    if is_invalid {
        return Err(AppError::InvalidInput(format!(
            "Invalid note file name: `{file_name}`"
        )));
    }

    Ok(())
}

/// What Windows takes as a plain file name: `:` would name a stream of
/// another file, a device name like `CON` opens the device, and a trailing
/// dot or space is dropped.
fn is_windows_file_name(file_name: &str) -> bool {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = file_name.split('.').next().unwrap_or_default().trim_end();
    !file_name
        .chars()
        .any(|c| c.is_control() || "<>:\"|?*".contains(c))
        && !file_name.ends_with(['.', ' '])
        && !RESERVED.iter().any(|name| stem.eq_ignore_ascii_case(name))
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
    use crate::services::test_support::TestDir;

    #[test]
    fn plugin_notes_stay_inside_approved_roots() {
        let directory = TestDir::new("scoped-note");
        let root = directory.join("notes");
        let roots = vec![root.to_string_lossy().into_owned()];
        let child = root.join("year/month");
        let path =
            write_scoped_note(&roots, child.to_str().unwrap(), "note.md", "one", false).unwrap();
        write_scoped_note(&roots, child.to_str().unwrap(), "note.md", "two", true).unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "one\ntwo");
        assert!(write_scoped_note(
            &roots,
            root.parent().unwrap().to_str().unwrap(),
            "escape.md",
            "text",
            false
        )
        .is_err());
        assert!(write_scoped_note(
            &roots,
            root.join("../escape").to_str().unwrap(),
            "note.md",
            "text",
            false
        )
        .is_err());
        #[cfg(unix)]
        {
            let outside = directory.join("outside");
            fs::create_dir_all(&outside).unwrap();
            std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
            assert!(write_scoped_note(
                &roots,
                root.join("link").to_str().unwrap(),
                "escape.md",
                "text",
                false
            )
            .is_err());
            fs::write(outside.join("target.md"), "original").unwrap();
            std::os::unix::fs::symlink(outside.join("target.md"), root.join("linked.md")).unwrap();
            assert!(
                write_scoped_note(&roots, root.to_str().unwrap(), "linked.md", "text", true)
                    .is_err()
            );
            assert_eq!(
                fs::read_to_string(outside.join("target.md")).unwrap(),
                "original"
            );
        }
    }
    #[test]
    fn concurrent_appends_preserve_lines() {
        let dir = TestDir::new("concurrent-notes");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("entries.md");
        fs::write(&file, "initial").unwrap();
        std::thread::scope(|scope| {
            for index in 0..32 {
                let dir = &dir;
                scope.spawn(move || {
                    append_note(
                        dir.to_str().unwrap(),
                        "entries.md",
                        &format!("entry-{index}"),
                    )
                    .unwrap()
                });
            }
        });
        let raw = fs::read_to_string(file).unwrap();
        let lines = raw.lines().collect::<std::collections::BTreeSet<_>>();
        assert_eq!(raw.lines().count(), 33);
        assert_eq!(lines.len(), 33);
        assert!(lines.contains("initial"));
        for index in 0..32 {
            assert!(lines.contains(format!("entry-{index}").as_str()));
        }
    }

    #[test]
    fn rejects_names_windows_does_not_take_as_files() {
        for name in [
            "a:stream.md",
            "CON",
            "nul.txt",
            "note.",
            "note ",
            "a?b",
            "a\u{1}b",
        ] {
            assert!(!is_windows_file_name(name), "{name}");
        }
        for name in ["note.md", "console.md", "2026-10-11.md"] {
            assert!(is_windows_file_name(name), "{name}");
        }
    }
    /// Keep an owned parent while testing creation of a missing directory.
    fn temp_path(label: &str) -> (TestDir, PathBuf) {
        let directory = TestDir::new(label);
        let path = directory.join("notes");
        (directory, path)
    }

    #[test]
    fn creates_missing_directory_and_writes_text() {
        let (_directory, root) = temp_path("create");
        let dir = root.join("nested");

        let path = save_note(dir.to_str().unwrap(), "note.md", "hello").unwrap();

        assert_eq!(path, dir.join("note.md"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn never_overwrites_existing_notes() {
        let (_directory, dir) = temp_path("collision");
        let dir_str = dir.to_str().unwrap();

        let first = save_note(dir_str, "note.md", "first").unwrap();
        let second = save_note(dir_str, "note.md", "second").unwrap();
        let third = save_note(dir_str, "note.md", "third").unwrap();

        assert_eq!(first, dir.join("note.md"));
        assert_eq!(second, dir.join("note-1.md"));
        assert_eq!(third, dir.join("note-2.md"));
        assert_eq!(fs::read_to_string(&first).unwrap(), "first");
        assert_eq!(fs::read_to_string(&second).unwrap(), "second");
    }

    #[test]
    fn rejects_file_names_that_escape_the_directory() {
        let (_directory, dir) = temp_path("invalid-name");
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
        let (_directory, dir) = temp_path("append");
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
    }
}
