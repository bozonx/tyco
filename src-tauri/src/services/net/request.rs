//! Turning a request from the webview into one that may leave the machine.
//!
//! Pure: no I/O, so every rule about where a secret may go is unit-tested.

use url::form_urlencoded::byte_serialize;
use url::Url;

use crate::services::secrets::{is_id_char, origin_of, Secrets, SECRET_REF_PREFIX};

/// `tyco-secret:` as `encodeURIComponent` writes it into a query string.
const ENCODED_REF_PREFIX: &str = "tyco-secret%3A";

/// Hop-by-hop and length headers are the HTTP client's business, not the
/// caller's: a stale `content-length` would corrupt the request.
const DROPPED_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedRequest {
    pub url: Url,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    Http,
    WebSocket,
}

pub fn request_origin(protocol: Protocol, value: &str) -> Result<String, String> {
    let url = Url::parse(value).map_err(|error| format!("Invalid URL \"{value}\": {error}"))?;
    let allowed_schemes: &[&str] = match protocol {
        Protocol::Http => &["http", "https"],
        Protocol::WebSocket => &["ws", "wss"],
    };
    if !allowed_schemes.contains(&url.scheme()) {
        return Err(format!("Unsupported URL scheme \"{}\"", url.scheme()));
    }
    origin_of(&url).ok_or_else(|| format!("URL \"{url}\" has no host"))
}

/// Validates the URL and fills secret references in the headers and the
/// query string. References anywhere else are left as they are: the body is
/// the caller's data and never gets a key written into it.
pub fn prepare(
    protocol: Protocol,
    url: &str,
    headers: &[(String, String)],
    secrets: &Secrets,
) -> Result<PreparedRequest, String> {
    let mut url = Url::parse(url).map_err(|error| format!("Invalid URL \"{url}\": {error}"))?;
    let allowed_schemes: &[&str] = match protocol {
        Protocol::Http => &["http", "https"],
        Protocol::WebSocket => &["ws", "wss"],
    };
    if !allowed_schemes.contains(&url.scheme()) {
        return Err(format!("Unsupported URL scheme \"{}\"", url.scheme()));
    }
    let origin = origin_of(&url).ok_or_else(|| format!("URL \"{url}\" has no host"))?;

    let resolve = |id: &str| -> Result<&str, String> {
        let entry = secrets
            .get(id)
            .ok_or_else(|| format!("No secret \"{id}\" is configured"))?;
        if entry.origins.contains(&origin) {
            Ok(entry.value.as_str())
        } else {
            Err(format!("Secret \"{id}\" may not be sent to {origin}"))
        }
    };

    if let Some(query) = url.query() {
        let query = replace_refs(query, ENCODED_REF_PREFIX, |id| {
            resolve(id).map(|value| byte_serialize(value.as_bytes()).collect())
        })?;
        let query = replace_refs(&query, SECRET_REF_PREFIX, |id| {
            resolve(id).map(|value| byte_serialize(value.as_bytes()).collect())
        })?;
        url.set_query(Some(&query));
    }

    let headers = headers
        .iter()
        .filter(|(name, _)| !DROPPED_HEADERS.contains(&name.to_ascii_lowercase().as_str()))
        .map(|(name, value)| {
            replace_refs(value, SECRET_REF_PREFIX, |id| {
                resolve(id).map(str::to_string)
            })
            .map(|value| (name.clone(), value))
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(PreparedRequest { url, headers })
}

/// Replaces every `<prefix><id>` in `text` with what `resolve` returns for it.
fn replace_refs(
    text: &str,
    prefix: &str,
    mut resolve: impl FnMut(&str) -> Result<String, String>,
) -> Result<String, String> {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(start) = rest.find(prefix) {
        result.push_str(&rest[..start]);
        let after = &rest[start + prefix.len()..];
        let id_len = after.find(|c: char| !is_id_char(c)).unwrap_or(after.len());
        let id = &after[..id_len];
        if id.is_empty() {
            return Err(String::from("Empty secret reference"));
        }
        result.push_str(&resolve(id)?);
        rest = &after[id_len..];
    }

    result.push_str(rest);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::secrets::SecretEntry;

    fn secrets() -> Secrets {
        let mut secrets = Secrets::new();
        secrets.insert(
            "google".into(),
            SecretEntry {
                value: "g-key".into(),
                origins: vec!["https://generativelanguage.googleapis.com".into()],
            },
        );
        secrets.insert(
            "google-translate".into(),
            SecretEntry {
                value: "t key/+".into(),
                origins: vec!["https://translation.googleapis.com".into()],
            },
        );
        secrets.insert(
            "deepl".into(),
            SecretEntry {
                value: "deepl-key".into(),
                origins: vec![
                    "https://api.deepl.com".into(),
                    "https://api-free.deepl.com".into(),
                ],
            },
        );
        secrets.insert(
            "deepgram".into(),
            SecretEntry {
                value: "dg-key".into(),
                origins: vec!["https://api.deepgram.com".into()],
            },
        );
        secrets
    }

    fn header(name: &str, value: &str) -> (String, String) {
        (name.into(), value.into())
    }

    #[test]
    fn fills_a_header_reference() {
        let prepared = prepare(
            Protocol::Http,
            "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent",
            &[
                header("x-goog-api-key", "tyco-secret:google"),
                header("content-type", "application/json"),
            ],
            &secrets(),
        )
        .unwrap();

        assert_eq!(
            prepared.headers,
            vec![
                header("x-goog-api-key", "g-key"),
                header("content-type", "application/json")
            ]
        );
    }

    #[test]
    fn fills_a_bearer_reference() {
        let mut all = secrets();
        all.insert(
            "deepseek".into(),
            SecretEntry {
                value: "sk-1".into(),
                origins: vec!["https://api.deepseek.com".into()],
            },
        );
        let prepared = prepare(
            Protocol::Http,
            "https://api.deepseek.com/chat/completions",
            &[header("Authorization", "Bearer tyco-secret:deepseek")],
            &all,
        )
        .unwrap();
        assert_eq!(
            prepared.headers,
            vec![header("Authorization", "Bearer sk-1")]
        );
    }

    #[test]
    fn fills_an_encoded_query_reference() {
        let prepared = prepare(
            Protocol::Http,
            "https://translation.googleapis.com/language/translate/v2?key=tyco-secret%3Agoogle-translate&x=1",
            &[],
            &secrets(),
        )
        .unwrap();
        assert_eq!(
            prepared.url.query(),
            Some("key=t+key%2F%2B&x=1"),
            "the value is encoded for a query string"
        );
    }

    #[test]
    fn refuses_a_secret_for_another_origin() {
        let error = prepare(
            Protocol::Http,
            "https://attacker.example/collect",
            &[header("x-goog-api-key", "tyco-secret:google")],
            &secrets(),
        )
        .unwrap_err();
        assert!(error.contains("may not be sent to https://attacker.example"));

        let error = prepare(
            Protocol::Http,
            "https://attacker.example/collect?k=tyco-secret%3Agoogle",
            &[],
            &secrets(),
        )
        .unwrap_err();
        assert!(error.contains("may not be sent"));
    }

    #[test]
    fn refuses_a_lookalike_origin() {
        for url in [
            "http://generativelanguage.googleapis.com/x",
            "https://generativelanguage.googleapis.com:8443/x",
            "https://generativelanguage.googleapis.com.attacker.example/x",
        ] {
            assert!(
                prepare(
                    Protocol::Http,
                    url,
                    &[header("x-goog-api-key", "tyco-secret:google")],
                    &secrets()
                )
                .is_err(),
                "{url}"
            );
        }
    }

    #[test]
    fn refuses_an_unknown_secret() {
        let error = prepare(
            Protocol::Http,
            "https://openrouter.ai/api/v1/chat/completions",
            &[header("authorization", "Bearer tyco-secret:openrouter")],
            &secrets(),
        )
        .unwrap_err();
        assert!(error.contains("No secret \"openrouter\""));
    }

    #[test]
    fn websocket_uses_the_https_origin() {
        let prepared = prepare(
            Protocol::WebSocket,
            "wss://api.deepgram.com/v1/listen?model=nova-3",
            &[header("authorization", "Token tyco-secret:deepgram")],
            &secrets(),
        )
        .unwrap();
        assert_eq!(
            prepared.headers,
            vec![header("authorization", "Token dg-key")]
        );
    }

    #[test]
    fn checks_the_scheme_per_protocol() {
        assert!(prepare(Protocol::Http, "wss://api.deepgram.com", &[], &secrets()).is_err());
        assert!(prepare(
            Protocol::WebSocket,
            "https://api.deepgram.com",
            &[],
            &secrets()
        )
        .is_err());
        assert!(prepare(Protocol::Http, "file:///etc/passwd", &[], &secrets()).is_err());
    }

    #[test]
    fn passes_requests_without_references() {
        let prepared = prepare(
            Protocol::Http,
            "http://localhost:11434/v1/chat/completions",
            &[
                header("content-type", "application/json"),
                header("Content-Length", "12"),
                header("host", "evil"),
            ],
            &secrets(),
        )
        .unwrap();
        assert_eq!(
            prepared.headers,
            vec![header("content-type", "application/json")]
        );
    }

    #[test]
    fn rejects_an_empty_reference() {
        assert!(prepare(
            Protocol::Http,
            "https://api.deepgram.com",
            &[header("authorization", "Token tyco-secret:")],
            &secrets()
        )
        .is_err());
    }
}
