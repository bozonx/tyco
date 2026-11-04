//! Web search and webpage reading tools using Jina AI.
use std::time::Duration;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::services::ai_vault::{AiProfile, ProjectAccessMode};

pub use crate::desktop_contract::WEB_TOOL_GROUP_ID as WEB_TOOL_GROUP;

const DEFAULT_SEARCH_COUNT: usize = 5;
const MAX_SEARCH_COUNT: usize = 20;
const MAX_QUERY_LEN: usize = 1000;
const WEB_TIMEOUT: Duration = Duration::from_secs(30);
const USER_AGENT: &str = concat!("TyCo/", env!("CARGO_PKG_VERSION"));

pub const DEFAULT_FETCH_MAX_CHARS: usize = 15_000;
pub const MAX_FETCH_CHARS: usize = 100_000;
pub const MIN_FETCH_CHARS: usize = 1_000;
const MAX_SEARCH_SNIPPET_LEN: usize = 1000;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiWebToolRequest {
    Search {
        query: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        count: Option<usize>,
    },
    Fetch {
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        max_characters: Option<usize>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResultItem {
    pub title: String,
    pub url: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiWebToolOutput {
    Search {
        results: Vec<WebSearchResultItem>,
    },
    Fetch {
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        title: Option<String>,
        content: String,
    },
}

#[derive(Deserialize)]
struct JinaSearchEnvelope {
    #[serde(default)]
    data: Option<Vec<JinaSearchItem>>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Deserialize)]
struct JinaSearchItem {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Deserialize)]
struct JinaReaderEnvelope {
    #[serde(default)]
    data: Option<JinaReaderData>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Deserialize)]
struct JinaReaderData {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    content: Option<String>,
}

/// Checks that the profile has the web tool group enabled and not set to `deny`.
pub fn ensure_web_enabled(profile: &AiProfile) -> Result<(), AppError> {
    let group = profile
        .tools
        .as_ref()
        .and_then(|tools| tools.groups.get(WEB_TOOL_GROUP));
    let is_allowed = group
        .map(|g| g.is_enabled && g.access != ProjectAccessMode::Deny)
        .unwrap_or(false);
    if is_allowed {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            "Web tools are not enabled for this profile".into(),
        ))
    }
}

fn format_jina_http_error(
    service: &str,
    status: reqwest::StatusCode,
    body_text: &str,
    secret_present: bool,
) -> AppError {
    let code = status.as_u16();
    if code == 429 {
        let hint = if secret_present {
            "Please check your Jina AI plan or quota limits, or try again later."
        } else {
            "Rate limit exceeded on the shared free tier. Please add a Jina API key in LLM settings or try again later."
        };
        AppError::Failed(format!("{service} rate limit exceeded (HTTP 429). {hint}"))
    } else if code == 401 || code == 403 {
        AppError::Failed(format!(
            "{service} authentication failed (HTTP {code}). Please check your Jina API key in LLM settings."
        ))
    } else if code == 404 {
        AppError::Failed(format!("{service} resource not found (HTTP 404)."))
    } else {
        let trimmed = body_text.trim();
        let is_html = trimmed.to_ascii_lowercase().starts_with("<!doctype")
            || trimmed.to_ascii_lowercase().starts_with("<html");
        if is_html || trimmed.is_empty() {
            AppError::Failed(format!("{service} failed with HTTP {code}"))
        } else {
            let snippet: String = trimmed.chars().take(200).collect();
            AppError::Failed(format!("{service} failed with HTTP {code}: {snippet}"))
        }
    }
}

pub(crate) fn truncate_with_note(content: &str, limit: usize) -> String {
    let char_count = content.chars().count();
    if char_count <= limit {
        return content.to_string();
    }
    let truncated: String = content.chars().take(limit).collect();
    format!("{truncated}\n\n[Content truncated: showing first {limit} of {char_count} characters]")
}

pub async fn run(
    secret: Option<&str>,
    request: AiWebToolRequest,
) -> Result<AiWebToolOutput, AppError> {
    let client = crate::services::net::client_builder()
        .timeout(WEB_TIMEOUT)
        .build()
        .map_err(|e| AppError::Failed(format!("Failed to build HTTP client: {e}")))?;

    match request {
        AiWebToolRequest::Search { query, count } => {
            let trimmed = query.trim();
            if trimmed.is_empty() {
                return Err(AppError::InvalidInput(
                    "Search query cannot be empty".into(),
                ));
            }
            if trimmed.len() > MAX_QUERY_LEN {
                return Err(AppError::InvalidInput(format!(
                    "Search query is too long (max {MAX_QUERY_LEN} characters)"
                )));
            }

            let count = count
                .unwrap_or(DEFAULT_SEARCH_COUNT)
                .clamp(1, MAX_SEARCH_COUNT);
            let encoded_query = utf8_percent_encode(trimmed, NON_ALPHANUMERIC).to_string();
            let target_url = format!("https://s.jina.ai/{encoded_query}");

            let mut req = client
                .get(&target_url)
                .header("Accept", "application/json")
                .header("User-Agent", USER_AGENT)
                .header("X-No-Cache", "true")
                .header("X-Respond-With", "no-content");

            if let Some(token) = secret.filter(|s| !s.trim().is_empty()) {
                req = req.header("Authorization", format!("Bearer {token}"));
            }

            let response = req
                .send()
                .await
                .map_err(|e| AppError::Failed(format!("Jina search request failed: {e}")))?;

            let status = response.status();
            let body_text = response.text().await.map_err(|e| {
                AppError::Failed(format!("Failed to read Jina search response: {e}"))
            })?;

            let has_secret = secret.map(|s| !s.trim().is_empty()).unwrap_or(false);
            if !status.is_success() {
                return Err(format_jina_http_error(
                    "Jina search",
                    status,
                    &body_text,
                    has_secret,
                ));
            }

            if let Ok(envelope) = serde_json::from_str::<JinaSearchEnvelope>(&body_text) {
                if let Some(items) = envelope.data {
                    let results = items
                        .into_iter()
                        .take(count)
                        .map(|item| {
                            let description = item.description.unwrap_or_default();
                            let truncated_desc =
                                if description.chars().count() > MAX_SEARCH_SNIPPET_LEN {
                                    let t: String =
                                        description.chars().take(MAX_SEARCH_SNIPPET_LEN).collect();
                                    format!("{t}...")
                                } else {
                                    description
                                };
                            WebSearchResultItem {
                                title: item.title.unwrap_or_default(),
                                url: item.url.unwrap_or_default(),
                                description: truncated_desc,
                                content: None,
                            }
                        })
                        .collect();
                    return Ok(AiWebToolOutput::Search { results });
                }
                if let Some(msg) = envelope.message {
                    return Err(AppError::Failed(format!("Jina search error: {msg}")));
                }
            }

            Err(AppError::Failed(
                "Failed to parse search response from Jina AI".into(),
            ))
        }
        AiWebToolRequest::Fetch {
            url,
            max_characters,
        } => {
            let trimmed = url.trim();
            let parsed = url::Url::parse(trimmed)
                .map_err(|e| AppError::InvalidInput(format!("Invalid URL: {e}")))?;
            if parsed.scheme() != "http" && parsed.scheme() != "https" {
                return Err(AppError::InvalidInput(
                    "URL must start with http:// or https://".into(),
                ));
            }

            let target_url = format!("https://r.jina.ai/{}", parsed.as_str());
            let mut req = client
                .get(&target_url)
                .header("Accept", "application/json")
                .header("User-Agent", USER_AGENT)
                .header("X-Return-Format", "markdown");

            if let Some(token) = secret.filter(|s| !s.trim().is_empty()) {
                req = req.header("Authorization", format!("Bearer {token}"));
            }

            let response = req
                .send()
                .await
                .map_err(|e| AppError::Failed(format!("Jina reader request failed: {e}")))?;

            let status = response.status();
            let body_text = response.text().await.map_err(|e| {
                AppError::Failed(format!("Failed to read Jina reader response: {e}"))
            })?;

            let has_secret = secret.map(|s| !s.trim().is_empty()).unwrap_or(false);
            if !status.is_success() {
                return Err(format_jina_http_error(
                    "Jina reader",
                    status,
                    &body_text,
                    has_secret,
                ));
            }

            let limit = max_characters
                .unwrap_or(DEFAULT_FETCH_MAX_CHARS)
                .clamp(MIN_FETCH_CHARS, MAX_FETCH_CHARS);

            if let Ok(envelope) = serde_json::from_str::<JinaReaderEnvelope>(&body_text) {
                if let Some(data) = envelope.data {
                    let content = data.content.unwrap_or_default();
                    let truncated_content = truncate_with_note(&content, limit);
                    return Ok(AiWebToolOutput::Fetch {
                        url: data.url.unwrap_or_else(|| trimmed.to_string()),
                        title: data.title,
                        content: truncated_content,
                    });
                }
                if let Some(msg) = envelope.message {
                    return Err(AppError::Failed(format!("Jina reader error: {msg}")));
                }
            }

            // Fallback for direct markdown response: check if it looks like HTML error
            let trimmed_body = body_text.trim();
            let is_html = trimmed_body.to_ascii_lowercase().starts_with("<!doctype")
                || trimmed_body.to_ascii_lowercase().starts_with("<html");
            if is_html {
                return Err(AppError::Failed(
                    "Jina reader returned an unexpected HTML page instead of article content"
                        .into(),
                ));
            }

            let truncated_content = truncate_with_note(trimmed_body, limit);
            Ok(AiWebToolOutput::Fetch {
                url: trimmed.to_string(),
                title: None,
                content: truncated_content,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::ai_vault::{ProfileToolSettings, ToolGroupSettings};
    use std::collections::HashMap;

    #[test]
    fn test_ensure_web_enabled_allows_when_configured() {
        let mut groups = HashMap::new();
        groups.insert(
            WEB_TOOL_GROUP.to_string(),
            ToolGroupSettings {
                is_enabled: true,
                access: ProjectAccessMode::Allow,
                command_ids: None,
            },
        );
        let profile = AiProfile {
            id: "p1".into(),
            name: "Test Profile".into(),
            model_id: None,
            temperature: None,
            max_output_tokens: None,
            memory_mode: Default::default(),
            tools: Some(ProfileToolSettings {
                groups,
                max_step_count: None,
            }),
            project_permissions: HashMap::new(),
            created_at: 1,
            updated_at: 1,
        };

        assert!(ensure_web_enabled(&profile).is_ok());
    }

    #[test]
    fn test_ensure_web_enabled_denies_when_disabled_or_missing() {
        let profile_no_tools = AiProfile {
            id: "p1".into(),
            name: "Test Profile".into(),
            model_id: None,
            temperature: None,
            max_output_tokens: None,
            memory_mode: Default::default(),
            tools: None,
            project_permissions: HashMap::new(),
            created_at: 1,
            updated_at: 1,
        };
        assert!(ensure_web_enabled(&profile_no_tools).is_err());

        let mut groups = HashMap::new();
        groups.insert(
            WEB_TOOL_GROUP.to_string(),
            ToolGroupSettings {
                is_enabled: false,
                access: ProjectAccessMode::Allow,
                command_ids: None,
            },
        );
        let profile_disabled = AiProfile {
            id: "p1".into(),
            name: "Test Profile".into(),
            model_id: None,
            temperature: None,
            max_output_tokens: None,
            memory_mode: Default::default(),
            tools: Some(ProfileToolSettings {
                groups,
                max_step_count: None,
            }),
            project_permissions: HashMap::new(),
            created_at: 1,
            updated_at: 1,
        };
        assert!(ensure_web_enabled(&profile_disabled).is_err());
    }

    #[test]
    fn test_parse_jina_search_response() {
        let json = r#"{
            "code": 200,
            "data": [
                {
                    "title": "Rust Programming Language",
                    "url": "https://www.rust-lang.org/",
                    "description": "A language empowering everyone to build reliable and efficient software.",
                    "content": "Rust is blazingly fast and memory-efficient..."
                }
            ]
        }"#;

        let envelope: JinaSearchEnvelope = serde_json::from_str(json).unwrap();
        let items = envelope.data.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title.as_deref(), Some("Rust Programming Language"));
        assert_eq!(items[0].url.as_deref(), Some("https://www.rust-lang.org/"));
    }

    #[test]
    fn test_parse_jina_reader_response() {
        let json = "{\"code\": 200, \"data\": {\"title\": \"Example Page\", \"url\": \"https://example.com\", \"content\": \"# Hello World\\n\\nThis is a test.\"}}";

        let envelope: JinaReaderEnvelope = serde_json::from_str(json).unwrap();
        let data = envelope.data.unwrap();
        assert_eq!(data.title.as_deref(), Some("Example Page"));
        assert_eq!(
            data.content.as_deref(),
            Some("# Hello World\n\nThis is a test.")
        );
    }

    #[test]
    fn test_truncate_with_note() {
        let short = "Hello World";
        assert_eq!(truncate_with_note(short, 20), "Hello World");

        let long = "Привет, это длинный текст для проверки обрезки страниц.";
        let truncated = truncate_with_note(long, 10);
        assert!(truncated.starts_with("Привет, эт"));
        assert!(truncated.contains("[Content truncated: showing first 10 of "));
    }

    #[test]
    fn test_format_jina_http_error() {
        let err_429_free = format_jina_http_error(
            "Jina search",
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            "rate limit",
            false,
        );
        assert!(err_429_free.to_string().contains("shared free tier"));

        let err_429_paid = format_jina_http_error(
            "Jina search",
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            "rate limit",
            true,
        );
        assert!(err_429_paid.to_string().contains("quota limits"));

        let err_401 = format_jina_http_error(
            "Jina reader",
            reqwest::StatusCode::UNAUTHORIZED,
            "unauthorized",
            true,
        );
        assert!(err_401
            .to_string()
            .contains("authentication failed (HTTP 401)"));

        let err_html = format_jina_http_error(
            "Jina search",
            reqwest::StatusCode::BAD_GATEWAY,
            "<!DOCTYPE html><html><body>Error</body></html>",
            false,
        );
        assert_eq!(err_html.to_string(), "Jina search failed with HTTP 502");
    }

    #[tokio::test]
    async fn test_run_input_validation() {
        // Empty search query
        let res = run(
            None,
            AiWebToolRequest::Search {
                query: "   ".into(),
                count: None,
            },
        )
        .await;
        assert!(matches!(res, Err(AppError::InvalidInput(_))));

        // Query too long
        let long_query = "x".repeat(MAX_QUERY_LEN + 1);
        let res = run(
            None,
            AiWebToolRequest::Search {
                query: long_query,
                count: None,
            },
        )
        .await;
        assert!(matches!(res, Err(AppError::InvalidInput(_))));

        // Invalid URL
        let res = run(
            None,
            AiWebToolRequest::Fetch {
                url: "not a url".into(),
                max_characters: None,
            },
        )
        .await;
        assert!(matches!(res, Err(AppError::InvalidInput(_))));

        // Non-http(s) scheme
        let res = run(
            None,
            AiWebToolRequest::Fetch {
                url: "ftp://example.com/file.txt".into(),
                max_characters: None,
            },
        )
        .await;
        assert!(matches!(res, Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn test_format_jina_http_error_empty_secret() {
        let has_secret = Some("   ")
            .map(|s: &str| !s.trim().is_empty())
            .unwrap_or(false);
        assert!(!has_secret);

        let err = format_jina_http_error(
            "Jina search",
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            "rate limit",
            has_secret,
        );
        assert!(err.to_string().contains("shared free tier"));
    }
}
