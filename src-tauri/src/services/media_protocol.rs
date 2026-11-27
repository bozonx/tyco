//! The `tyco-media://` scheme: the media the webview plays with its own
//! `<audio>` element, named by id, never by path. It answers byte ranges, so
//! a long recording streams and seeks without being read whole.
//!
//! Requests reach it as `tyco-media://localhost/recording/<dialog id>/<file name>`, or
//! `http://tyco-media.localhost/...` on Windows. See `dev_docs/architecture.md`.
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use tauri::http::{header, Request, Response, StatusCode};

use crate::errors::AppError;
use crate::services::storage::recordings::{self, RecordingDirs};

pub const SCHEME: &str = "tyco-media";

/// The most one response carries: the element asks for the rest itself.
const MAX_CHUNK_BYTES: u64 = 2 * 1024 * 1024;
const RECORDING_TYPE: &str = "audio/ogg; codecs=opus";

/// A byte range of a file of `size` bytes, both ends included.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end: u64,
}

/// The range a `Range` header asks for within `size` bytes, capped at
/// `MAX_CHUNK_BYTES`: `Ok(None)` without one the scheme understands (several
/// ranges, another unit), `Err(())` for a range past the end.
fn requested_range(value: Option<&str>, size: u64) -> Result<Option<ByteRange>, ()> {
    let Some(spec) = value.and_then(|value| value.trim().strip_prefix("bytes=")) else {
        return Ok(None);
    };
    if spec.contains(',') {
        return Ok(None);
    }
    let Some((start, end)) = spec.split_once('-') else {
        return Ok(None);
    };
    let (start, end) = (start.trim(), end.trim());
    let (start, end) = if start.is_empty() {
        // the last `end` bytes
        let Ok(suffix) = end.parse::<u64>() else {
            return Ok(None);
        };
        if suffix == 0 || size == 0 {
            return Err(());
        }
        (size.saturating_sub(suffix.min(MAX_CHUNK_BYTES)), size - 1)
    } else {
        let Ok(start) = start.parse::<u64>() else {
            return Ok(None);
        };
        let end = match end {
            "" => size.saturating_sub(1),
            end => match end.parse::<u64>() {
                Ok(end) if end >= start => end.min(size.saturating_sub(1)),
                _ => return Ok(None),
            },
        };
        (start, end)
    };
    if start >= size {
        return Err(());
    }
    Ok(Some(ByteRange {
        start,
        end: end.min(start + MAX_CHUNK_BYTES - 1),
    }))
}

fn read_range(file: &mut File, range: ByteRange) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(range.start))?;
    let mut bytes = Vec::new();
    file.take(range.end - range.start + 1)
        .read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn base_response(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::CONTENT_SECURITY_POLICY, "default-src 'none'")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
}

fn text_response(status: StatusCode, text: &str) -> Response<Vec<u8>> {
    base_response(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(text.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Serves the file at `path` of `content_type`, the range the request asks
/// for or, without one, the complete representation.
fn file_response(
    path: &Path,
    content_type: &str,
    range_header: Option<&str>,
) -> std::io::Result<Response<Vec<u8>>> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let range = match requested_range(range_header, size) {
        Ok(range) => range,
        Err(()) => {
            return Ok(base_response(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new())));
        }
    };
    let (status, range) = match range {
        Some(range) => (StatusCode::PARTIAL_CONTENT, range),
        None => (
            StatusCode::OK,
            ByteRange {
                start: 0,
                end: size.saturating_sub(1),
            },
        ),
    };
    let body = if size == 0 {
        Vec::new()
    } else {
        read_range(&mut file, range)?
    };
    let mut builder = base_response(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, body.len());
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{size}", range.start, range.end),
        );
    }
    Ok(builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new())))
}

/// The recording a request path names: `/recording/<dialog id>/<file name>`.
fn recording_target(path: &str) -> Option<(String, String)> {
    let rest = path.strip_prefix("/recording/")?;
    let (encoded_dialog_id, encoded_name) = rest.split_once('/')?;
    if encoded_name.contains('/') {
        return None;
    }
    let dialog_id = percent_encoding::percent_decode_str(encoded_dialog_id)
        .decode_utf8()
        .ok()?
        .into_owned();
    let name = percent_encoding::percent_decode_str(encoded_name)
        .decode_utf8()
        .ok()?
        .into_owned();
    Some((dialog_id, name))
}

/// Answers a request of the scheme with the recordings in `dirs`.
pub fn respond_with(dirs: &RecordingDirs, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some((dialog_id, name)) = recording_target(request.uri().path()) else {
        return text_response(StatusCode::NOT_FOUND, "Unknown media");
    };
    let path = match recordings::playable_file(dirs, &dialog_id, &name) {
        Ok(path) => path,
        Err(AppError::InvalidInput(_)) => {
            return text_response(StatusCode::BAD_REQUEST, "Not a call recording")
        }
        Err(_) => return text_response(StatusCode::NOT_FOUND, "The recording is unavailable"),
    };
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    file_response(&path, RECORDING_TYPE, range).unwrap_or_else(|error| {
        log::warn!("Could not read a call recording: {error}");
        text_response(StatusCode::NOT_FOUND, "The recording is unavailable")
    })
}

/// Answers a request of the scheme with the recordings of the app.
pub fn respond(app: &tauri::AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let dirs = match recording_target(request.uri().path()) {
        Some((dialog_id, _)) => RecordingDirs::of_dialog(app, &dialog_id),
        None => RecordingDirs::of_app(app),
    };
    match dirs {
        Ok(dirs) => respond_with(&dirs, request),
        Err(_) => text_response(StatusCode::NOT_FOUND, "The recordings are unavailable"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    const DIALOG_ID: &str = "2031-01-02_03-04-05_0d1a0d";
    const NAME: &str = "2031-01-02 03-04-05 0d1a0d.opus";

    fn request(path: &str, range: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder().uri(format!("tyco-media://localhost{path}"));
        if let Some(range) = range {
            builder = builder.header(header::RANGE, range);
        }
        builder.body(Vec::new()).unwrap()
    }

    fn with_recording(label: &str, bytes: &[u8]) -> (TestDir, RecordingDirs) {
        let root = TestDir::new(label);
        let dirs = RecordingDirs::at(&root);
        let dialog_dir = dirs.shared.join(DIALOG_ID);
        std::fs::create_dir_all(&dialog_dir).unwrap();
        std::fs::write(dialog_dir.join(NAME), bytes).unwrap();
        (root, dirs)
    }

    const ENCODED_PATH: &str =
        "/recording/2031-01-02_03-04-05_0d1a0d/2031-01-02%2003-04-05%200d1a0d.opus";

    #[test]
    fn ranges_are_parsed_within_the_file_and_capped() {
        let range = |value, size| requested_range(Some(value), size);
        assert_eq!(
            range("bytes=0-9", 100),
            Ok(Some(ByteRange { start: 0, end: 9 }))
        );
        assert_eq!(
            range("bytes=90-", 100),
            Ok(Some(ByteRange { start: 90, end: 99 }))
        );
        assert_eq!(
            range("bytes=-10", 100),
            Ok(Some(ByteRange { start: 90, end: 99 }))
        );
        assert_eq!(
            range("bytes=50-500", 100),
            Ok(Some(ByteRange { start: 50, end: 99 }))
        );
        assert_eq!(range("bytes=100-", 100), Err(()));
        assert_eq!(range("bytes=0-1,5-6", 100), Ok(None));
        assert_eq!(range("items=0-1", 100), Ok(None));
        assert_eq!(range("bytes=9-1", 100), Ok(None));
        let huge = 10 * MAX_CHUNK_BYTES;
        assert_eq!(
            range("bytes=0-", huge),
            Ok(Some(ByteRange {
                start: 0,
                end: MAX_CHUNK_BYTES - 1
            }))
        );
        assert_eq!(requested_range(None, 100), Ok(None));
    }

    #[test]
    fn a_recording_is_served_whole_or_by_range() {
        let (_root, dirs) = with_recording("media-recording", b"0123456789");
        let whole = respond_with(&dirs, &request(ENCODED_PATH, None));
        assert_eq!(whole.status(), StatusCode::OK);
        assert_eq!(whole.body(), b"0123456789");
        assert_eq!(whole.headers()[header::CONTENT_TYPE], RECORDING_TYPE);
        assert_eq!(whole.headers()[header::ACCEPT_RANGES], "bytes");

        let part = respond_with(&dirs, &request(ENCODED_PATH, Some("bytes=2-4")));
        assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(part.body(), b"234");
        assert_eq!(part.headers()[header::CONTENT_RANGE], "bytes 2-4/10");

        let past = respond_with(&dirs, &request(ENCODED_PATH, Some("bytes=10-")));
        assert_eq!(past.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(past.headers()[header::CONTENT_RANGE], "bytes */10");
    }

    #[test]
    fn large_recordings_support_whole_reads_and_a_seek_past_the_first_chunk() {
        let boundary = MAX_CHUNK_BYTES as usize;
        let mut bytes = vec![0; boundary + 3];
        bytes[boundary..].copy_from_slice(b"end");
        let (_root, dirs) = with_recording("large-media-recording", &bytes);

        let whole = respond_with(&dirs, &request(ENCODED_PATH, None));
        assert_eq!(whole.status(), StatusCode::OK);
        assert_eq!(whole.body(), &bytes);
        assert!(!whole.headers().contains_key(header::CONTENT_RANGE));

        let first = respond_with(&dirs, &request(ENCODED_PATH, Some("bytes=0-")));
        assert_eq!(first.body().len(), boundary);
        let rest = respond_with(
            &dirs,
            &request(ENCODED_PATH, Some(&format!("bytes={boundary}-"))),
        );
        assert_eq!(rest.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(rest.body(), b"end");
    }

    #[test]
    fn only_finished_recordings_are_served() {
        let (_root, dirs) = with_recording("media-names", b"x");
        for path in [
            "/recording/..%2F..%2Fsecret/2031-01-02%2003-04-05%200d1a0d.opus",
            "/recording/2031-01-02_03-04-05_0d1a0d/notes.txt",
            "/recording/notes.txt",
            "/elsewhere/2031-01-02_03-04-05_0d1a0d/2031-01-02%2003-04-05%200d1a0d.opus",
        ] {
            assert!(respond_with(&dirs, &request(path, None))
                .status()
                .is_client_error());
        }
        let absent = "/recording/2031-01-02_03-04-05_0d1a0d/2031-01-02%2003-04-05%20ffffff.opus";
        assert_eq!(
            respond_with(&dirs, &request(absent, None)).status(),
            StatusCode::NOT_FOUND
        );

        // a name of its own: the other tests read theirs meanwhile
        let running = "2031-01-02 03-04-05 0d1a0e.opus";
        std::fs::write(dirs.shared.join(DIALOG_ID).join(running), b"x").unwrap();
        recordings::begin_writing(DIALOG_ID, running);
        let path = "/recording/2031-01-02_03-04-05_0d1a0d/2031-01-02%2003-04-05%200d1a0e.opus";
        let written = respond_with(&dirs, &request(path, None)).status();
        recordings::end_writing(DIALOG_ID, running);
        assert_eq!(written, StatusCode::NOT_FOUND);
    }
}
