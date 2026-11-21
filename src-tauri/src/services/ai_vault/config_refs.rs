//! Points the settings that name a profile to where it moved: grid items,
//! prompts and every other `profileId` with its optional `vaultId`
//! (`dev_docs/config-storage.md`). Plugin sections are opaque and kept.
use serde_json::{Map, Value};

/// Sections whose content belongs to plugins and is never rewritten.
const OPAQUE_SECTIONS: [&str; 1] = ["plugins"];

/// The reference `[vaultId:]id` an object of the config names, if any.
fn named_ref(object: &Map<String, Value>) -> Option<String> {
    let profile_id = object.get("profileId")?.as_str()?;
    if profile_id.is_empty() {
        return None;
    }
    let vault_id = object
        .get("vaultId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Some(super::join_ref(vault_id, profile_id))
}

fn rewrite(value: &mut Value, from: &str, to: &str) -> bool {
    match value {
        Value::Array(items) => {
            // every item is rewritten, not only the first that names it
            let mut changed = false;
            for item in items {
                changed |= rewrite(item, from, to);
            }
            changed
        }
        Value::Object(object) => {
            let mut changed = false;
            if named_ref(object).as_deref() == Some(from) {
                let (vault_id, profile_id) = super::split_ref(to);
                object.insert("profileId".into(), Value::from(profile_id));
                // the main vault is named by leaving the vault out
                if vault_id.is_empty() {
                    object.remove("vaultId");
                } else {
                    object.insert("vaultId".into(), Value::from(vault_id));
                }
                changed = true;
            }
            for (key, child) in object.iter_mut() {
                if key != "profileId" && key != "vaultId" {
                    changed |= rewrite(child, from, to);
                }
            }
            changed
        }
        _ => false,
    }
}

/// Rewrites, in place, every reference of `config` to the profile `from` to
/// name `to`. Returns whether anything changed.
pub fn rewrite_profile_refs(config: &mut Value, from: &str, to: &str) -> bool {
    if from == to {
        return false;
    }
    let Value::Object(sections) = config else {
        return false;
    };
    let mut changed = false;
    for (key, section) in sections.iter_mut() {
        if !OPAQUE_SECTIONS.contains(&key.as_str()) {
            changed |= rewrite(section, from, to);
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn references_to_the_moved_profile_follow_it() {
        let mut config = json!({
            "grid": { "items": [
                { "kind": "profileChat", "profileId": "p1" },
                { "kind": "profile", "profileId": "p1", "vaultId": "w1" },
                { "kind": "profile", "profileId": "p2" }
            ]},
            "chatPrompts": { "items": [{ "profileId": "p1", "text": "x" }] },
            "plugins": { "a": { "profileId": "p1" } }
        });
        assert!(rewrite_profile_refs(&mut config, "p1", "w2:p9"));
        assert_eq!(
            config["grid"]["items"][0],
            json!({ "kind": "profileChat", "profileId": "p9", "vaultId": "w2" })
        );
        // another vault's profile of the same id is not the moved one
        assert_eq!(config["grid"]["items"][1]["vaultId"], "w1");
        assert_eq!(config["grid"]["items"][1]["profileId"], "p1");
        assert_eq!(config["grid"]["items"][2]["profileId"], "p2");
        assert_eq!(config["chatPrompts"]["items"][0]["vaultId"], "w2");
        assert_eq!(config["plugins"]["a"], json!({ "profileId": "p1" }));
    }

    #[test]
    fn a_move_to_the_main_vault_drops_the_vault_part() {
        let mut config = json!({ "grid": [{ "profileId": "p1", "vaultId": "w1" }] });
        assert!(rewrite_profile_refs(&mut config, "w1:p1", "p1"));
        assert_eq!(config["grid"][0], json!({ "profileId": "p1" }));
    }

    #[test]
    fn nothing_named_changes_nothing() {
        let mut config = json!({ "grid": [{ "profileId": "p2" }] });
        let before = config.clone();
        assert!(!rewrite_profile_refs(&mut config, "p1", "w1:p1"));
        assert!(!rewrite_profile_refs(&mut config, "p2", "p2"));
        assert_eq!(config, before);
    }
}
