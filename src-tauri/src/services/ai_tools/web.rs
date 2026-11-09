//! Web search and webpage reading tools using Jina AI.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Notify;

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
        /// The character the returned page starts at, to read on after a cut
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        offset: Option<usize>,
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
        /// The page from `offset`, at most `maxCharacters` long
        content: String,
        offset: usize,
        total_characters: usize,
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
        if is_html_body(trimmed) || trimmed.is_empty() {
            AppError::Failed(format!("{service} failed with HTTP {code}"))
        } else {
            let snippet: String = trimmed.chars().take(200).collect();
            AppError::Failed(format!("{service} failed with HTTP {code}: {snippet}"))
        }
    }
}

fn is_html_body(body: &str) -> bool {
    let start: String = body.trim_start().chars().take(16).collect();
    let start = start.to_ascii_lowercase();
    start.starts_with("<!doctype") || start.starts_with("<html")
}

/// The part of the page the model asked for and the length of the whole page.
fn page_slice(content: &str, offset: usize, limit: usize) -> (String, usize) {
    let total = content.chars().count();
    (content.chars().skip(offset).take(limit).collect(), total)
}

/// Web tool calls in flight, so that the chat can stop them.
#[derive(Default)]
pub struct WebRuns {
    runs: Mutex<HashMap<String, Arc<Notify>>>,
}

impl WebRuns {
    /// Runs `future` until it ends or `cancel(run_id)` is called.
    pub async fn run<T>(
        &self,
        run_id: Option<&str>,
        future: impl std::future::Future<Output = Result<T, AppError>>,
    ) -> Result<T, AppError> {
        let Some(run_id) = run_id else {
            return future.await;
        };
        let notify = Arc::new(Notify::new());
        self.lock().insert(run_id.to_string(), notify.clone());
        let result = tokio::select! {
            result = future => result,
            () = notify.notified() => Err(AppError::Failed("The tool call was cancelled".into())),
        };
        self.lock().remove(run_id);
        result
    }

    /// Stops a run; false when it is not running.
    pub fn cancel(&self, run_id: &str) -> bool {
        match self.lock().remove(run_id) {
            Some(notify) => {
                notify.notify_one();
                true
            }
            None => false,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Notify>>> {
        self.runs.lock().unwrap_or_else(|e| e.into_inner())
    }
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
            offset,
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

            let offset = offset.unwrap_or(0);
            let limit = max_characters
                .unwrap_or(DEFAULT_FETCH_MAX_CHARS)
                .clamp(MIN_FETCH_CHARS, MAX_FETCH_CHARS);

            if let Ok(envelope) = serde_json::from_str::<JinaReaderEnvelope>(&body_text) {
                if let Some(data) = envelope.data {
                    let (content, total_characters) =
                        page_slice(&data.content.unwrap_or_default(), offset, limit);
                    return Ok(AiWebToolOutput::Fetch {
                        url: data.url.unwrap_or_else(|| trimmed.to_string()),
                        title: data.title,
                        content,
                        offset,
                        total_characters,
                    });
                }
                if let Some(msg) = envelope.message {
                    return Err(AppError::Failed(format!("Jina reader error: {msg}")));
                }
            }

            // Fallback for a plain Markdown response; an HTML page is an error page
            let trimmed_body = body_text.trim();
            if is_html_body(trimmed_body) {
                return Err(AppError::Failed(
                    "Jina reader returned an unexpected HTML page instead of article content"
                        .into(),
                ));
            }

            let (content, total_characters) = page_slice(trimmed_body, offset, limit);
            Ok(AiWebToolOutput::Fetch {
                url: trimmed.to_string(),
                title: None,
                content,
                offset,
                total_characters,
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
            quick_request_model_id: None,
            max_output_tokens: None,
            memory_mode: Default::default(),
            tools: Some(ProfileToolSettings {
                groups,
                max_step_count: None,
            }),
            project_permissions: HashMap::new(),
            created_at: 1,
            updated_at: 1,
            revision: None,
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
            quick_request_model_id: None,
            max_output_tokens: None,
            memory_mode: Default::default(),
            tools: None,
            project_permissions: HashMap::new(),
            created_at: 1,
            updated_at: 1,
            revision: None,
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
            quick_request_model_id: None,
            max_output_tokens: None,
            memory_mode: Default::default(),
            tools: Some(ProfileToolSettings {
                groups,
                max_step_count: None,
            }),
            project_permissions: HashMap::new(),
            created_at: 1,
            updated_at: 1,
            revision: None,
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
    fn test_page_slice() {
        assert_eq!(page_slice("Hello World", 0, 20), ("Hello World".into(), 11));

        let long = "Привет, это длинный текст";
        assert_eq!(page_slice(long, 0, 10), ("Привет, эт".into(), 25));
        assert_eq!(page_slice(long, 20, 10), ("текст".into(), 25));
        assert_eq!(page_slice(long, 100, 10), (String::new(), 25));
    }

    #[test]
    fn test_is_html_body() {
        assert!(is_html_body("  <!DOCTYPE html><html>"));
        assert!(is_html_body("<HTML>"));
        assert!(!is_html_body("# Title"));
    }

    #[tokio::test]
    async fn test_web_runs_cancel() {
        let runs = Arc::new(WebRuns::default());
        let pending = {
            let runs = runs.clone();
            tokio::spawn(async move {
                runs.run(Some("r1"), std::future::pending::<Result<(), AppError>>())
                    .await
            })
        };
        while !runs.lock().contains_key("r1") {
            tokio::task::yield_now().await;
        }
        assert!(runs.cancel("r1"));
        assert!(pending.await.unwrap().is_err());
        assert!(!runs.cancel("r1"));
        assert!(runs.run(Some("r2"), async { Ok(1) }).await.is_ok());
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
                offset: None,
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
                offset: None,
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
