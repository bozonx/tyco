//! Shows a directory in the platform's file manager, or a file in the
//! application associated with its type.

use std::path::Path;
use std::process::Command;

use crate::errors::AppError;

/// How long the system opener may take before it is stopped.
const OPEN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Opens `dir` in the file manager.
pub fn open_dir(dir: &Path) -> Result<(), AppError> {
    if !dir.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Not a directory: {}",
            dir.display()
        )));
    }
    open_path(dir)
}

/// Opens `file` in the application the desktop associates with its type.
pub fn open_file(file: &Path) -> Result<(), AppError> {
    if !file.is_file() {
        return Err(AppError::InvalidInput(format!(
            "Not a file: {}",
            file.display()
        )));
    }
    open_path(file)
}

fn open_path(path: &Path) -> Result<(), AppError> {
    let mut command = Command::new(opener());
    command.arg(path);
    // Explorer may exit with 1 even when the path opened successfully.
    // Ignore its exit code, but still bound execution and reap the child.
    super::process::status(command, None, OPEN_TIMEOUT)?;
    Ok(())
}

fn opener() -> &'static str {
    if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer.exe"
    } else {
        "xdg-open"
    }
}

/// Only web pages are opened: the URL comes from the webview, and the system
/// opener would just as well run a local file or another URL handler.
pub fn parse_web_url(value: &str) -> Result<url::Url, AppError> {
    let url = url::Url::parse(value.trim())
        .map_err(|error| AppError::InvalidInput(format!("Invalid URL \"{value}\": {error}")))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        scheme => Err(AppError::InvalidInput(format!(
            "Refusing to open a \"{scheme}:\" URL; only http and https are allowed"
        ))),
    }
}

/// Opens `value` in the browser when it is an http or https address.
pub fn open_web_page(value: &str) -> Result<(), AppError> {
    open_web_url(&parse_web_url(value)?)
}

/// Opens a validated web URL using the desktop handler.
fn open_web_url(url: &url::Url) -> Result<(), AppError> {
    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    } else {
        Command::new(opener())
    };
    command.arg(url.as_str());
    let status = super::process::status(command, None, OPEN_TIMEOUT)?;
    if !status.success() {
        return Err(AppError::Failed(format!(
            "URL opener failed with status {status}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn rejects_non_web_pages_without_launching_a_process() {
        for url in ["file:///etc/passwd", "javascript:alert(1)", "not a url"] {
            assert!(open_web_page(url).is_err());
        }
    }

    #[test]
    fn accepts_web_urls_only() {
        assert!(parse_web_url("https://duckduckgo.com/?q=a%20b&hl=en").is_ok());
        assert!(parse_web_url(" http://example.com ").is_ok());
        assert!(parse_web_url("http://localhost:8080/path?key=val#hash").is_ok());
        assert!(parse_web_url("file:///etc/passwd").is_err());
        assert!(parse_web_url("javascript:alert(1)").is_err());
        assert!(parse_web_url("data:text/html,<b>hi</b>").is_err());
        assert!(parse_web_url("ftp://example.com/file").is_err());
        assert!(parse_web_url("ws://example.com/socket").is_err());
        assert!(parse_web_url("").is_err());
        assert!(parse_web_url("   ").is_err());
        assert!(parse_web_url("not a url").is_err());
    }

    #[test]
    fn rejects_invalid_paths_before_opening() {
        let dir = TestDir::new("file-manager-test");
        let file_path = dir.join("test.txt");
        std::fs::write(&file_path, "sample").unwrap();
        let missing = dir.join("nonexistent");

        assert!(open_dir(&file_path).is_err());
        assert!(open_dir(&missing).is_err());

        assert!(open_file(&dir).is_err());
        assert!(open_file(&missing).is_err());
    }

    #[test]
    fn chooses_expected_opener() {
        let op = opener();
        if cfg!(target_os = "macos") {
            assert_eq!(op, "open");
        } else if cfg!(target_os = "windows") {
            assert_eq!(op, "explorer.exe");
        } else {
            assert_eq!(op, "xdg-open");
        }
    }
}
