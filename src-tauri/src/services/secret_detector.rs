//! Heuristic masking of things that look like passwords, keys and tokens.
//!
//! A best effort for the history files, not a guarantee: a secret in a shape
//! no rule knows stays as it is.

use regex::{Captures, Regex, RegexSet};
use std::sync::OnceLock;

/// What every replacement starts with. A match that already contains it is
/// left alone, so masking a masked text changes nothing.
const MARK: &str = "[REDACTED";

struct SecretRules {
    set: RegexSet,
    rules: Vec<(Regex, &'static str)>,
}

fn secret_rules() -> &'static SecretRules {
    static RULES: OnceLock<SecretRules> = OnceLock::new();
    RULES.get_or_init(|| {
        // Specific token shapes come first: the generic key-value rule at the
        // end then finds their values already masked.
        let raw_rules: Vec<(&str, &str)> = vec![
            (
                r"(?is)-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----.*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----",
                "[REDACTED PRIVATE KEY]",
            ),
            // OpenAI, Anthropic, DeepSeek, OpenRouter and alike
            (
                r"\bsk-(?:proj-|ant-|live-|or-)?[A-Za-z0-9_-]{20,}",
                "[REDACTED API KEY]",
            ),
            // Stripe
            (
                r"\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}",
                "[REDACTED API KEY]",
            ),
            (
                r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})",
                "[REDACTED GITHUB TOKEN]",
            ),
            (
                r"\b(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b",
                "[REDACTED AWS KEY]",
            ),
            (r"\bxox[abposr]-[A-Za-z0-9-]{10,}", "[REDACTED SLACK TOKEN]"),
            (r"\bAIza[0-9A-Za-z_-]{35}", "[REDACTED GOOGLE API KEY]"),
            (
                r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}",
                "[REDACTED TOKEN]",
            ),
            (
                r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/-]{16,}=*",
                "$1 [REDACTED TOKEN]",
            ),
            // Credentials in a URI of any scheme: https://user:pass@host,
            // postgres://user:pass@host. Neither part crosses a `/`, so a port
            // followed by a path is not taken for a password.
            (
                r"(?i)\b([a-z][a-z0-9+.-]*://[^\s:/@]+):[^\s/@]+@",
                "$1:[REDACTED PASSWORD]@",
            ),
            // password=secret123, api_key: "abc", пароль: qwerty12. An unquoted
            // value needs 6 characters, so that "password: is required"
            // survives.
            (
                r#"(?i)\b(password|passwd|pwd|pass|secret|client[_-]?secret|token|api[_-]?key|access[_-]?key|access[_-]?token|private[_-]?key|пароль|токен|ключ)(\s*[:=]\s*)(?:"[^"\n]+"|'[^'\n]+'|[^\s;,"'`]{6,})"#,
                "$1$2[REDACTED SECRET]",
            ),
        ];

        let set_patterns: Vec<&str> = raw_rules.iter().map(|(pattern, _)| *pattern).collect();
        let set = RegexSet::new(set_patterns).expect("Failed to compile the secret rules");

        let rules = raw_rules
            .into_iter()
            .map(|(pattern, replacement)| {
                (
                    Regex::new(pattern).expect("Failed to compile a secret rule"),
                    replacement,
                )
            })
            .collect();

        SecretRules { set, rules }
    })
}

/// Masks what looks like passwords, API keys, tokens and private keys.
/// Idempotent: a text masked once comes out of a second pass unchanged.
pub fn redact_secrets(text: &str) -> String {
    let rules_ref = secret_rules();
    if !rules_ref.set.is_match(text) {
        return text.to_string();
    }

    let mut result = text.to_string();
    for (regex, replacement) in &rules_ref.rules {
        if !regex.is_match(&result) {
            continue;
        }
        result = regex
            .replace_all(&result, |caps: &Captures| {
                let matched = &caps[0];
                if matched.contains(MARK) {
                    return matched.to_string();
                }
                let mut expanded = String::new();
                caps.expand(replacement, &mut expanded);
                expanded
            })
            .into_owned();
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
    fn redacts_a_key_ending_with_a_dash() {
        let output = redact_secrets("key sk-abcdefghijklmnopqrstuvw- end");
        assert_eq!(output, "key [REDACTED API KEY] end");
    }

    #[test]
    fn redacts_password_key_value_assignments() {
        let input = "password=mysecretpassword123; api_key: 'sk-12345678901234567890'";
        let output = redact_secrets(input);
        assert!(output.contains("[REDACTED SECRET]"));
        assert!(!output.contains("mysecretpassword123"));
        assert!(!output.contains("sk-1234"));
    }

    #[test]
    fn redacts_russian_key_value_assignments() {
        let output = redact_secrets("Пароль: qwerty12, остальное как было");
        assert_eq!(output, "Пароль: [REDACTED SECRET], остальное как было");
    }

    #[test]
    fn leaves_short_words_after_password_alone() {
        let input = "The password: is required";
        assert_eq!(redact_secrets(input), input);
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
    fn redacts_credentials_in_database_urls() {
        let output = redact_secrets("DATABASE_URL=postgres://app:s3cr3t@db:5432/app");
        assert_eq!(
            output,
            "DATABASE_URL=postgres://app:[REDACTED PASSWORD]@db:5432/app"
        );
    }

    #[test]
    fn leaves_a_port_followed_by_a_path_alone() {
        let input = "Open http://localhost:8080/users@home";
        assert_eq!(redact_secrets(input), input);
    }

    #[test]
    fn redacts_bearer_tokens_and_jwts() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        let output = redact_secrets(&format!("token {jwt}"));
        assert_eq!(output, "token [REDACTED TOKEN]");

        let output = redact_secrets("Authorization: Bearer abcdefghijklmnop1234");
        assert_eq!(output, "Authorization: Bearer [REDACTED TOKEN]");
    }

    #[test]
    fn redacts_stripe_keys() {
        let output = redact_secrets("sk_live_1234567890abcdefABCD");
        assert_eq!(output, "[REDACTED API KEY]");
    }

    #[test]
    fn a_second_pass_changes_nothing() {
        let input = "password=hunter22 https://u:p4ss@host api_key: \"abc def\" sk-proj-1234567890abcdef1234567890";
        let once = redact_secrets(input);
        assert_eq!(redact_secrets(&once), once);
    }

    #[test]
    fn leaves_normal_text_intact() {
        let input = "Hello world! This is a simple note without any secrets or keys.";
        assert_eq!(redact_secrets(input), input);
    }
}
