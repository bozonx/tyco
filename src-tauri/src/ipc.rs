//! What the IPC commands share beyond their domain: the binary argument and
//! the JSON arguments the backend validates itself.

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{Map, Value};
use tauri::ipc::{CommandArg, CommandItem, InvokeBody, InvokeError};
use tauri::Runtime;
use ts_rs::TS;

use crate::errors::AppError;

/// Carries the metadata of a binary argument, as percent-encoded JSON.
/// Mirrored by the desktop client in `apps/desktop-ui/src/lib/desktop`.
pub const BINARY_META_HEADER: &str = "x-tyco-meta";

/// Bytes sent as the raw IPC body, so they are not turned into JSON, with
/// their metadata `M` beside them. The generated bindings show it as
/// `{ bytes: Uint8Array; meta: M }`.
pub struct BinaryRequest<M> {
    pub bytes: Vec<u8>,
    pub meta: M,
}

impl<M: DeserializeOwned> BinaryRequest<M> {
    fn parse(body: &InvokeBody, header: Option<&[u8]>) -> Result<Self, AppError> {
        let InvokeBody::Raw(bytes) = body else {
            return Err(AppError::InvalidInput("Expected a raw binary body".into()));
        };
        let header = header.ok_or_else(|| {
            AppError::InvalidInput(format!("Missing {BINARY_META_HEADER} header"))
        })?;
        let meta = percent_encoding::percent_decode(header)
            .decode_utf8()
            .map_err(|_| AppError::InvalidInput("Binary metadata is not UTF-8".into()))?;
        Ok(Self {
            bytes: bytes.clone(),
            meta: serde_json::from_str(&meta).map_err(|error| {
                AppError::InvalidInput(format!("Invalid binary metadata: {error}"))
            })?,
        })
    }
}

impl<'a, R: Runtime, M: DeserializeOwned> CommandArg<'a, R> for BinaryRequest<M> {
    fn from_command(command: CommandItem<'a, R>) -> Result<Self, InvokeError> {
        let header = command
            .message
            .headers()
            .get(BINARY_META_HEADER)
            .map(|value| value.as_bytes());
        Self::parse(command.message.payload(), header).map_err(InvokeError::from)
    }
}

/// The user config as the webview sends it; its schema is checked where it
/// is saved. `UserConfig` of `@tyco/shared` in the bindings.
#[derive(Deserialize)]
#[serde(transparent)]
pub struct UserConfig(pub Value);

impl TS for UserConfig {
    type WithoutGenerics = Self;
    type OptionInnerType = Self;

    fn name(_: &ts_rs::Config) -> String {
        "UserConfig".into()
    }

    fn inline(cfg: &ts_rs::Config) -> String {
        Self::name(cfg)
    }
}

/// Some fields of the `SessionState`, checked when they are merged.
#[derive(Deserialize)]
#[serde(transparent)]
pub struct SessionStatePatch(pub Map<String, Value>);

impl TS for SessionStatePatch {
    type WithoutGenerics = Self;
    type OptionInnerType = Self;

    fn name(_: &ts_rs::Config) -> String {
        "SessionStatePatch".into()
    }

    fn inline(cfg: &ts_rs::Config) -> String {
        format!("Partial<{}>", crate::models::SessionState::name(cfg))
    }

    fn decl(cfg: &ts_rs::Config) -> String {
        format!("type SessionStatePatch = {};", Self::inline(cfg))
    }

    fn decl_concrete(cfg: &ts_rs::Config) -> String {
        Self::decl(cfg)
    }

    fn visit_dependencies(visitor: &mut impl ts_rs::TypeVisitor) {
        visitor.visit::<crate::models::SessionState>();
    }

    fn output_path() -> Option<std::path::PathBuf> {
        Some("SessionStatePatch.ts".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize, Debug, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct Meta {
        import_id: String,
        name: Option<String>,
    }

    #[test]
    fn reads_the_raw_body_and_the_encoded_metadata() {
        let request = BinaryRequest::<Meta>::parse(
            &InvokeBody::Raw(vec![1, 2, 3]),
            Some(b"%7B%22importId%22%3A%22a%22%2C%22name%22%3A%22%D1%84.png%22%7D"),
        )
        .unwrap();
        assert_eq!(request.bytes, [1, 2, 3]);
        assert_eq!(
            request.meta,
            Meta {
                import_id: "a".into(),
                name: Some("ф.png".into())
            }
        );
    }

    #[test]
    fn rejects_json_bodies_and_missing_or_malformed_metadata() {
        let json = InvokeBody::Json(serde_json::json!({}));
        assert!(BinaryRequest::<Meta>::parse(&json, Some(b"%7B%7D")).is_err());
        let raw = InvokeBody::Raw(Vec::new());
        assert!(BinaryRequest::<Meta>::parse(&raw, None).is_err());
        assert!(BinaryRequest::<Meta>::parse(&raw, Some(b"%7B")).is_err());
        assert!(BinaryRequest::<Meta>::parse(&raw, Some(b"%7B%7D")).is_err());
    }
}
