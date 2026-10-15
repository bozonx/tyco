use super::resolve_vault_path_from_config;
use crate::services::test_support::TestDir;

#[test]
fn resolve_vault_path_uses_fallback_when_unconfigured_or_empty() {
    let test_dir = TestDir::new("ai_vault_fallback");
    let fallback_path = test_dir.join("default-ai-vault");
    let fallback = || Ok(fallback_path.clone());

    let resolved = resolve_vault_path_from_config(None, fallback).unwrap();
    assert_eq!(resolved, fallback_path);

    let resolved_empty = resolve_vault_path_from_config(Some(""), fallback).unwrap();
    assert_eq!(resolved_empty, fallback_path);

    let resolved_whitespace = resolve_vault_path_from_config(Some("   "), fallback).unwrap();
    assert_eq!(resolved_whitespace, fallback_path);
}

#[test]
fn resolve_vault_path_rejects_relative_path_and_uses_fallback() {
    let test_dir = TestDir::new("ai_vault_relative");
    let fallback_path = test_dir.join("default-ai-vault");
    let fallback = || Ok(fallback_path.clone());

    let resolved =
        resolve_vault_path_from_config(Some("relative/path/to/vault"), fallback).unwrap();
    assert_eq!(resolved, fallback_path);
}

#[test]
fn resolve_vault_path_accepts_valid_absolute_path() {
    let test_dir = TestDir::new("ai_vault_custom");
    let custom_vault = test_dir.join("my-custom-vault");
    let fallback_path = test_dir.join("default-ai-vault");
    let fallback = || Ok(fallback_path.clone());

    let resolved =
        resolve_vault_path_from_config(Some(custom_vault.to_str().unwrap()), fallback).unwrap();
    assert_eq!(resolved, custom_vault);
    assert!(custom_vault.is_dir());
}
