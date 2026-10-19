//! The `tyco-plugin://` scheme: the runtime of plugin frames and the modules
//! of installed plugins, each plugin on an origin of its own.
use tauri::Manager;

/// Requests reach it as `tyco-plugin://<plugin key>.localhost/...`.
pub const SCHEME: &str = "tyco-plugin";

/// Serves the runtime of plugin frames and the modules of installed plugins,
/// each plugin on an origin of its own.
pub fn respond(
    app: &tauri::AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let path = request.uri().path();
    let host = request.uri().host().unwrap_or_default();
    let plugin_key = host.strip_suffix(".localhost").unwrap_or_default();
    let valid_key = !plugin_key.is_empty()
        && plugin_key.len() <= 256
        && plugin_key.len().is_multiple_of(2)
        && plugin_key.bytes().all(|byte| byte.is_ascii_hexdigit());
    let static_asset = if !valid_key {
        None
    } else {
        match path {
            "/runtime/index.html" => Some((
                "text/html; charset=utf-8",
                include_str!("../../../plugin-runtime/index.html"),
            )),
            "/runtime/frame.js" => Some((
                "application/javascript; charset=utf-8",
                include_str!("../../../plugin-runtime/frame.js"),
            )),
            "/runtime/protocol.js" => Some((
                "application/javascript; charset=utf-8",
                include_str!("../../../../packages/plugin-sdk/src/runtime-protocol.js"),
            )),
            "/runtime/worker.js" => Some((
                "application/javascript; charset=utf-8",
                include_str!("../../../plugin-runtime/worker.js"),
            )),
            _ => None,
        }
    };
    let (status, content_type, body) = if !valid_key {
        (404, "text/plain", b"Plugin origin is unavailable".to_vec())
    } else if let Some((content_type, asset)) = static_asset {
        (200, content_type, asset.as_bytes().to_vec())
    } else if path.trim_start_matches('/').split('/').next() != Some(plugin_key) {
        (
            404,
            "text/plain",
            b"Plugin origin does not match package".to_vec(),
        )
    } else {
        match app.state::<super::PluginStore>().module(path) {
            Ok(module) => (
                200,
                "application/javascript; charset=utf-8",
                module.into_bytes(),
            ),
            Err(_) => (404, "text/plain", b"Plugin module is unavailable".to_vec()),
        }
    };
    // Workers receive their own policy and cannot reach the app's IPC origin.
    let worker_src = if path == "/runtime/index.html" {
        "'self'"
    } else {
        "'none'"
    };
    let policy = format!("default-src 'none'; script-src 'self'; connect-src 'none'; worker-src {worker_src}; object-src 'none'; base-uri 'none'; frame-src 'none'");
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Content-Security-Policy", policy)
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(body)
        .unwrap_or_else(|error| {
            log::error!("Could not build a plugin protocol response: {error}");
            tauri::http::Response::new(Vec::new())
        })
}
