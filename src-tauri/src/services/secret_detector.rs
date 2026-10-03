use regex::{Regex, RegexSet};
use std::sync::OnceLock;

struct SecretRules {
    set: RegexSet,
    rules: Vec<(Regex, &'static str)>,
}

fn secret_rules() -> &'static SecretRules {
    static RULES: OnceLock<SecretRules> = OnceLock::new();
    RULES.get_or_init(|| {
        let raw_rules: Vec<(&str, &str)> = vec![
            // Private Keys
            (
                r"(?is)-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----.*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----",
                "[REDACTED PRIVATE KEY]",
            ),
            // OpenAI / Anthropic / AI API Keys
            (
                r"\bsk-(?:proj-|ant-|live-)?[a-zA-Z0-9_-]{20,}\b",
                "[REDACTED API KEY]",
            ),
            // GitHub Tokens
            (
                r"\b(?:gh[pousr]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})\b",
                "[REDACTED GITHUB TOKEN]",
            ),
            // AWS Access Key ID
            (
                r"\b(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b",
                "[REDACTED AWS KEY]",
            ),
            // Slack Tokens
            (
                r"\bxox[baprs]-[a-zA-Z0-9]{10,48}\b",
                "[REDACTED SLACK TOKEN]",
            ),
            // Google API Key
            (
                r"\bAIza[0-9A-Za-z-_]{35}\b",
                "[REDACTED GOOGLE API KEY]",
            ),
            // Key-Value Password/Secret Assignments (e.g., password=secret123, api_key: "abc123xyz")
            (
                r#"(?i)\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*([:=])\s*(?:["'][^"']+["']|[^\s;,"'`]+)"#,
                "$1$2 [REDACTED SECRET]",
            ),
            // Basic Auth Passwords in URLs (e.g. https://user:pass@example.com)
            (
                r"(?i)(https?://[^:\s]+):([^@\s]+)@",
                "$1:[REDACTED PASSWORD]@",
            ),
        ];

        let set_patterns: Vec<&str> = raw_rules.iter().map(|(p, _)| *p).collect();
        let set = RegexSet::new(set_patterns).expect("Failed to compile Gitleaks RegexSet");

        let rules = raw_rules
            .into_iter()
            .map(|(pattern, replacement)| {
                (
                    Regex::new(pattern).expect("Failed to compile secret Regex"),
                    replacement,
                )
            })
            .collect();

        SecretRules { set, rules }
    })
}

/// Redacts passwords, API keys, tokens, and private keys from the text using Gitleaks-based patterns.
pub fn redact_secrets(text: &str) -> String {
    let rules_ref = secret_rules();
    if !rules_ref.set.is_match(text) {
        return text.to_string();
    }

    let mut result = text.to_string();
    for (regex, replacement) in &rules_ref.rules {
        if regex.is_match(&result) {
            result = regex.replace_all(&result, *replacement).to_string();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_openai_and_github_keys() {
        let input = "Here is my key: sk-proj-1234567890abcdef1234567890 and github ghp_123456789012345678901234567890123456";
        let output = redact_secrets(input);
        assert!(output.contains("[REDACTED API KEY]"));
        assert!(output.contains("[REDACTED GITHUB TOKEN]"));
        assert!(!output.contains("sk-proj-"));
        assert!(!output.contains("ghp_"));
    }

    #[test]
    fn redacts_password_key_value_assignments() {
        let input = "password=mysecretpassword123; api_key: 'sk-12345678901234567890'";
        let output = redact_secrets(input);
        assert!(output.contains("[REDACTED SECRET]"));
        assert!(!output.contains("mysecretpassword123"));
    }

    #[test]
    fn redacts_private_keys() {
        let input =
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
        let output = redact_secrets(input);
        assert_eq!(output, "[REDACTED PRIVATE KEY]");
    }

    #[test]
    fn redacts_url_basic_auth() {
        let input = "Connect to https://admin:supersecret@example.com/db";
        let output = redact_secrets(input);
        assert_eq!(
            output,
            "Connect to https://admin:[REDACTED PASSWORD]@example.com/db"
        );
    }

    #[test]
    fn leaves_normal_text_intact() {
        let input = "Hello world! This is a simple note without any secrets or keys.";
        assert_eq!(redact_secrets(input), input);
    }
}
