//! Update YAML nodes without rewriting unchanged comments, quotes, or key order.
use std::str::FromStr;

use serde_json::Value;
use yaml_edit::{Mapping, Sequence, YamlFile, YamlNode};

use crate::errors::AppError;

fn yaml_error(error: impl std::fmt::Display) -> AppError {
    AppError::Message(format!("Could not edit config YAML: {error}"))
}

fn node(value: &Value) -> Result<YamlNode, AppError> {
    let raw = serde_yaml::to_string(&serde_json::json!({ "value": value }))?;
    YamlFile::from_str(&raw)
        .map_err(yaml_error)?
        .document()
        .and_then(|document| document.get("value"))
        .ok_or_else(|| yaml_error("missing serialized value"))
}

fn update_mapping(mapping: &Mapping, previous: &Value, next: &Value) -> Result<(), AppError> {
    let fields = next
        .as_object()
        .ok_or_else(|| yaml_error("expected mapping"))?;
    if let Some(previous) = previous.as_object() {
        for key in previous.keys().filter(|key| !fields.contains_key(*key)) {
            mapping.remove(key.as_str());
        }
    }
    for (key, value) in fields {
        if previous.get(key) == Some(value) {
            continue;
        }
        if let Some(existing) = mapping.get(key.as_str()) {
            if update_nested(&existing, &previous[key], value)? {
                continue;
            }
        }
        mapping.set(key.as_str(), node(value)?);
    }
    Ok(())
}

fn update_sequence(
    sequence: &Sequence,
    previous: &[Value],
    next: &[Value],
) -> Result<(), AppError> {
    for (index, value) in next.iter().enumerate() {
        if previous[index] == *value {
            continue;
        }
        if let Some(existing) = sequence.get(index) {
            if update_nested(&existing, &previous[index], value)? {
                continue;
            }
        }
        sequence.set(index, node(value)?);
    }
    Ok(())
}

fn update_nested(existing: &YamlNode, previous: &Value, next: &Value) -> Result<bool, AppError> {
    if previous.is_object() && next.is_object() {
        if let Some(mapping) = existing.as_mapping() {
            update_mapping(mapping, previous, next)?;
            return Ok(true);
        }
    }
    if let (Some(before), Some(after), Some(sequence)) =
        (previous.as_array(), next.as_array(), existing.as_sequence())
    {
        if before.len() == after.len() {
            update_sequence(sequence, before, after)?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// The semantic check prevents a formatting edit from changing config values.
pub(super) fn render_config(previous_raw: Option<&str>, next: &Value) -> Result<String, AppError> {
    let Some(raw) = previous_raw else {
        return Ok(serde_yaml::to_string(next)?);
    };
    let previous: Value = serde_yaml::from_str(raw)?;
    let file = YamlFile::from_str(raw).map_err(yaml_error)?;
    let mapping = file
        .document()
        .and_then(|document| document.as_mapping())
        .ok_or_else(|| yaml_error("config is not a mapping"))?;
    let comments: Vec<String> = file
        .comments()
        .map(|comment| comment.content().to_string())
        .collect();
    update_mapping(&mapping, &previous, next)?;
    let remaining: Vec<String> = file
        .comments()
        .map(|comment| comment.content().to_string())
        .collect();
    let mut rendered = String::new();
    // A comment inside a replaced collection remains available as a file annotation.
    for comment in comments
        .iter()
        .filter(|comment| !remaining.contains(comment))
    {
        for line in comment.lines() {
            rendered.push_str("# ");
            rendered.push_str(line);
            rendered.push('\n');
        }
    }
    rendered.push_str(&file.to_string());
    let parsed: Value = serde_yaml::from_str(&rendered)?;
    if parsed != *next {
        return Err(yaml_error("edited YAML does not match the config"));
    }
    Ok(rendered)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn edits_nested_fields_preserving_comments_quotes_and_order() {
        let raw = "# My settings\ntheme: 'light' # appearance\nwindowInsertion:\n  # custom path\n  xdotoolBin: '/custom/xdotool'\n  method: xdotool\n";
        let next = json!({"theme":"dark","windowInsertion":{"xdotoolBin":"/custom/xdotool","method":"ydotool"}});
        let rendered = render_config(Some(raw), &next).unwrap();
        assert!(rendered.contains("# My settings"));
        assert!(rendered.contains("# appearance"));
        assert!(rendered.contains("# custom path"));
        assert!(rendered.contains("xdotoolBin: '/custom/xdotool'"));
        assert!(rendered.find("theme:").unwrap() < rendered.find("windowInsertion:").unwrap());
    }

    #[test]
    fn replacement_collections_preserve_annotations_and_exact_values() {
        let raw = "tasks:\n  # useful note\n  - id: 'one'\n    prompt: |\n      # literal prompt text\n      Do work\n";
        let next = json!({"tasks":[{"id":"two","prompt":"a: b\n# text"},{"id":"three","prompt":"true"}],"empty":[]});
        let rendered = render_config(Some(raw), &next).unwrap();
        assert!(rendered.contains("# useful note"));
        assert_eq!(serde_yaml::from_str::<Value>(&rendered).unwrap(), next);
    }

    #[test]
    fn unchanged_config_retains_its_original_bytes() {
        let raw = "# leading\nname: 'quoted'\nvalues: [1, 2] # trailing\n";
        let value: Value = serde_yaml::from_str(raw).unwrap();
        assert_eq!(render_config(Some(raw), &value).unwrap(), raw);
    }
}
