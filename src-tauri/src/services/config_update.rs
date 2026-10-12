//! Three-way config updates: independent edits in different windows survive.
use serde_json::{Map, Value};

use crate::errors::AppError;

pub fn merge_config(current: &Value, base: &Value, next: &Value) -> Result<Value, AppError> {
    if !current.is_object() || !base.is_object() || !next.is_object() {
        return Err(AppError::Message(
            "The user config must be an object".into(),
        ));
    }
    merge(Some(current), Some(base), Some(next), "userConfig")?
        .ok_or_else(|| AppError::Message("The user config cannot be removed".into()))
}

fn merge(
    current: Option<&Value>,
    base: Option<&Value>,
    next: Option<&Value>,
    path: &str,
) -> Result<Option<Value>, AppError> {
    if base == next || current == next {
        return Ok(current.cloned());
    }
    if current == base {
        return Ok(next.cloned());
    }
    if let (Some(Value::Object(current)), Some(Value::Object(base)), Some(Value::Object(next))) =
        (current, base, next)
    {
        let keys = current
            .keys()
            .chain(base.keys())
            .chain(next.keys())
            .collect::<std::collections::BTreeSet<_>>();
        let mut result = Map::new();
        for key in keys {
            if let Some(value) = merge(
                current.get(key),
                base.get(key),
                next.get(key),
                &format!("{path}.{key}"),
            )? {
                result.insert(key.clone(), value);
            }
        }
        return Ok(Some(Value::Object(result)));
    }
    Err(AppError::Message(format!(
        "Configuration changed in another window: {path}. Reopen settings before saving this field"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn independent_nested_edits_and_removals_survive() {
        let base = json!({"theme":"light", "llm":{"models":[],"name":"old"},"legacy":true});
        let current = json!({"theme":"dark", "llm":{"models":["new"],"name":"old"},"legacy":true});
        let next = json!({"theme":"light", "llm":{"models":[],"name":"mine"}});
        assert_eq!(
            merge_config(&current, &base, &next).unwrap(),
            json!({"theme":"dark","llm":{"models":["new"],"name":"mine"}})
        );
    }

    #[test]
    fn conflicting_arrays_and_deleted_objects_are_rejected() {
        let base = json!({"commands":[], "plugins":{"example":true}});
        for (current, next) in [
            (
                json!({"commands":[1],"plugins":{"example":true}}),
                json!({"commands":[2],"plugins":{"example":true}}),
            ),
            (
                json!({"commands":[]}),
                json!({"commands":[],"plugins":{"example":false}}),
            ),
        ] {
            assert!(merge_config(&current, &base, &next).is_err());
        }
    }

    #[test]
    fn identical_concurrent_edits_are_idempotent_and_invalid_roots_fail() {
        assert_eq!(
            merge_config(&json!({"x":2}), &json!({"x":1}), &json!({"x":2})).unwrap(),
            json!({"x":2})
        );
        assert!(merge_config(&json!({}), &Value::Null, &json!({})).is_err());
    }
}
