use sha2::{Digest, Sha256};
use url::Url;

use crate::errors::AppError;

const MAX_ID_LEN: usize = 64;

/// Where the well-known providers live. A secret stored under one of these
/// ids is bound to these origins unless the caller names others. An id names
/// what the key is for, `<namespace>.<name>`; see `secret-ids.ts` of the
/// shared package.
const BUILTIN_ORIGINS: &[(&str, &[&str])] = &[
    ("llm.google", &["https://generativelanguage.googleapis.com"]),
    ("llm.openrouter", &["https://openrouter.ai"]),
    ("llm.deepseek", &["https://api.deepseek.com"]),
    ("llm.openai", &["https://api.openai.com"]),
    ("llm.anthropic", &["https://api.anthropic.com"]),
    ("llm.groq", &["https://api.groq.com"]),
    (
        "translation.google",
        &["https://translation.googleapis.com"],
    ),
    (
        "translation.deepl",
        &["https://api.deepl.com", "https://api-free.deepl.com"],
    ),
    ("stt.deepgram", &["https://api.deepgram.com"]),
];

/// The trimmed value and the normalized origins of a secret to store.
pub(super) fn checked_secret<'a>(
    id: &str,
    value: &'a str,
    origins: Option<Vec<String>>,
) -> Result<(&'a str, Vec<String>), AppError> {
    validate_id(id)?;
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("Secret \"{id}\" is empty")));
    }

    let origins = match origins {
        Some(origins) if !origins.is_empty() => origins
            .iter()
            .map(|origin| normalize_origin(origin))
            .collect::<Result<Vec<_>, _>>()?,
        _ => builtin_origins(id).ok_or_else(|| {
            AppError::InvalidInput(format!(
                "Secret \"{id}\" is not a known provider; name the origins it may be sent to"
            ))
        })?,
    };
    Ok((value, dedup(origins)))
}

/// The app identifier, and for a development home a suffix of its own: the
/// system store is one per user, and a test setup must not read or delete
/// the real keys.
pub(super) fn vault_namespace(
    identifier: &str,
    dev_config_dir: Option<&std::path::Path>,
) -> String {
    match dev_config_dir {
        None => identifier.to_string(),
        Some(dir) => {
            let digest = Sha256::digest(dir.to_string_lossy().as_bytes());
            let suffix: String = digest[..4]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            format!("{identifier}.dev-{suffix}")
        }
    }
}

pub fn builtin_origins(id: &str) -> Option<Vec<String>> {
    BUILTIN_ORIGINS
        .iter()
        .find(|(builtin, _)| *builtin == id)
        .map(|(_, origins)| origins.iter().map(|origin| origin.to_string()).collect())
}

pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id.chars().all(is_id_char)
        && id.starts_with(|c: char| c.is_ascii_alphanumeric())
}

pub fn is_id_char(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-')
}

fn validate_id(id: &str) -> Result<(), AppError> {
    if is_valid_id(id) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "Invalid secret id \"{id}\""
        )))
    }
}

/// `scheme://host[:port]` of an HTTP or WebSocket URL, with `ws`/`wss` folded
/// into `http`/`https`: a provider's live endpoint is the same party as its
/// REST one.
pub fn origin_of(url: &Url) -> Option<String> {
    let scheme = match url.scheme() {
        "http" | "ws" => "http",
        "https" | "wss" => "https",
        _ => return None,
    };
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("{scheme}://{host}:{port}"),
        None => format!("{scheme}://{host}"),
    })
}

pub fn normalize_origin(origin: &str) -> Result<String, AppError> {
    let url = Url::parse(origin.trim())
        .map_err(|error| AppError::InvalidInput(format!("Invalid origin \"{origin}\": {error}")))?;
    origin_of(&url).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "Invalid origin \"{origin}\": expected an http(s) or ws(s) URL"
        ))
    })
}

fn dedup(origins: Vec<String>) -> Vec<String> {
    let mut result = Vec::with_capacity(origins.len());
    for origin in origins {
        if !result.contains(&origin) {
            result.push(origin);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins_keep_only_scheme_host_and_explicit_port() {
        let origin = |url: &str| origin_of(&Url::parse(url).unwrap());
        assert_eq!(
            origin("https://user:pass@API.Example.com/v1?key=1#x").as_deref(),
            Some("https://api.example.com")
        );
        assert_eq!(
            origin("http://localhost:11434/api").as_deref(),
            Some("http://localhost:11434")
        );
        // the default port is not part of the origin
        assert_eq!(
            origin("https://api.example.com:443/").as_deref(),
            Some("https://api.example.com")
        );
        assert_eq!(
            origin("ws://127.0.0.1:8080").as_deref(),
            Some("http://127.0.0.1:8080")
        );
        assert_eq!(origin("ftp://example.com"), None);
        assert_eq!(origin("data:text/plain,secret"), None);
    }

    #[test]
    fn invalid_origins_are_rejected() {
        assert!(normalize_origin("not a url").is_err());
        assert!(normalize_origin("").is_err());
        assert!(normalize_origin("javascript:alert(1)").is_err());
        assert_eq!(
            normalize_origin("  https://api.example.com/path  ").unwrap(),
            "https://api.example.com"
        );
    }

    #[test]
    fn ids_are_lowercase_names_starting_with_a_letter_or_digit() {
        for id in ["llm.openai", "a", "custom_1-x", &"a".repeat(MAX_ID_LEN)] {
            assert!(is_valid_id(id), "{id} is valid");
        }
        for id in [
            "",
            ".hidden",
            "-dash",
            "Upper",
            "with space",
            "../escape",
            "tyco-secret:x",
            &"a".repeat(MAX_ID_LEN + 1),
        ] {
            assert!(!is_valid_id(id), "{id} is invalid");
        }
    }

    #[test]
    fn checked_secrets_are_trimmed_and_bound_to_deduplicated_origins() {
        let (value, origins) = checked_secret(
            "custom",
            "  key  ",
            Some(vec![
                "https://api.example.com/v1".into(),
                "wss://api.example.com/live".into(),
                "https://other.example.com".into(),
            ]),
        )
        .unwrap();
        assert_eq!(value, "key");
        assert_eq!(
            origins,
            ["https://api.example.com", "https://other.example.com"]
        );
    }

    #[test]
    fn named_origins_override_the_builtin_ones() {
        let (_, origins) = checked_secret(
            "llm.openai",
            "key",
            Some(vec!["http://localhost:1234".into()]),
        )
        .unwrap();
        assert_eq!(origins, ["http://localhost:1234"]);
        let (_, origins) = checked_secret("llm.openai", "key", Some(Vec::new())).unwrap();
        assert_eq!(origins, ["https://api.openai.com"]);
    }

    #[test]
    fn checked_secret_rejects_blank_values_bad_ids_and_bad_origins() {
        assert!(checked_secret("llm.openai", " \n\t ", None).is_err());
        assert!(checked_secret("Bad Id", "key", None).is_err());
        assert!(checked_secret("custom", "key", None).is_err());
        assert!(checked_secret("custom", "key", Some(vec!["file:///etc".into()])).is_err());
    }

    #[test]
    fn development_homes_get_their_own_vault_namespace() {
        let real = vault_namespace("com.tyco.app", None);
        let first = vault_namespace("com.tyco.app", Some(std::path::Path::new("/dev/one")));
        let second = vault_namespace("com.tyco.app", Some(std::path::Path::new("/dev/two")));
        assert_eq!(real, "com.tyco.app");
        assert!(first.starts_with("com.tyco.app.dev-"));
        assert_ne!(first, second);
        assert_eq!(
            first,
            vault_namespace("com.tyco.app", Some(std::path::Path::new("/dev/one")))
        );
    }
}
