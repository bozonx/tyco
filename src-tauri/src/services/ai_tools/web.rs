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
    #[serde(default)]
    content: Option<String>,
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
                .header("User-Agent", "TyCo/0.1.0")
                .header("X-No-Cache", "true");

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

            if !status.is_success() {
                return Err(AppError::Failed(format!(
                    "Jina search failed with HTTP {status}: {body_text}"
                )));
            }

            if let Ok(envelope) = serde_json::from_str::<JinaSearchEnvelope>(&body_text) {
                if let Some(items) = envelope.data {
                    let results = items
                        .into_iter()
                        .take(count)
                        .map(|item| WebSearchResultItem {
                            title: item.title.unwrap_or_default(),
                            url: item.url.unwrap_or_default(),
                            description: item.description.unwrap_or_default(),
                            content: item.content,
                        })
                        .collect();
                    return Ok(AiWebToolOutput::Search { results });
                }
                if let Some(msg) = envelope.message {
                    return Err(AppError::Failed(format!(
                        "Jina search returned error: {msg}"
                    )));
                }
            }

            // Fallback if not standard JSON envelope: return plain markdown result as a single item
            Ok(AiWebToolOutput::Search {
                results: vec![WebSearchResultItem {
                    title: format!("Search: {trimmed}"),
                    url: target_url,
                    description: trimmed.to_string(),
                    content: Some(body_text),
                }],
            })
        }
        AiWebToolRequest::Fetch { url } => {
            let trimmed = url.trim();
            if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
                return Err(AppError::InvalidInput(
                    "URL must start with http:// or https://".into(),
                ));
            }

            let target_url = format!("https://r.jina.ai/{trimmed}");
            let mut req = client
                .get(&target_url)
                .header("Accept", "application/json")
                .header("User-Agent", "TyCo/0.1.0")
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

            if !status.is_success() {
                return Err(AppError::Failed(format!(
                    "Jina reader failed with HTTP {status}: {body_text}"
                )));
            }

            if let Ok(envelope) = serde_json::from_str::<JinaReaderEnvelope>(&body_text) {
                if let Some(data) = envelope.data {
                    return Ok(AiWebToolOutput::Fetch {
                        url: data.url.unwrap_or_else(|| trimmed.to_string()),
                        title: data.title,
                        content: data.content.unwrap_or_default(),
                    });
                }
                if let Some(msg) = envelope.message {
                    return Err(AppError::Failed(format!(
                        "Jina reader returned error: {msg}"
                    )));
                }
            }

            // Fallback: return raw markdown body
            Ok(AiWebToolOutput::Fetch {
                url: trimmed.to_string(),
                title: None,
                content: body_text,
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
}
