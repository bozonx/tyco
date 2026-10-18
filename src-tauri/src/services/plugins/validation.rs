//! Validates plugin metadata and bundled assets without executing code.
use super::{error, is_valid_plugin_id, PluginManifest, API_VERSION};
use crate::errors::AppError;

pub fn validate_manifest(manifest: &PluginManifest) -> Result<(), AppError> {
    validate_metadata(manifest)?;
    validate_locales(manifest)?;
    validate_icons(manifest)?;
    let has_notes = manifest
        .capabilities
        .iter()
        .any(|capability| capability == "notes");
    if manifest.notes_directory_field.is_some() && !has_notes {
        return Err(error("Invalid notes directory field"));
    }
    if has_notes {
        let name = manifest
            .notes_directory_field
            .as_deref()
            .unwrap_or("pathToNotes");
        let config = manifest
            .default_config
            .as_ref()
            .ok_or_else(|| error("Notes access requires an empty directory setting"))?;
        if !config["fields"].as_array().is_some_and(|fields| {
            fields.iter().any(|field| {
                field["name"].as_str() == Some(name)
                    && field["type"].as_str() == Some("text")
                    && field["defaultValue"].as_str() == Some("")
                    && field
                        .get("value")
                        .is_none_or(|value| value.as_str() == Some(""))
            })
        }) {
            return Err(error("Notes access requires an empty directory setting"));
        }
        if config["presets"].as_object().is_some_and(|selectors| {
            selectors.values().any(|presets| {
                presets.as_object().is_some_and(|presets| {
                    presets.values().any(|preset| {
                        preset
                            .get(name)
                            .is_some_and(|value| value.as_str() != Some(""))
                    })
                })
            })
        }) {
            return Err(error("Plugin presets cannot grant notes access"));
        }
    }
    if let Some(config) = &manifest.default_config {
        let fields = validate_config_fields(config)?;
        validate_presets(config, fields)?;
    }
    Ok(())
}

fn validate_metadata(manifest: &PluginManifest) -> Result<(), AppError> {
    let id = &manifest.id;
    if !is_valid_plugin_id(id) {
        return Err(error("Invalid plugin ID"));
    }
    let parts: Vec<_> = manifest.version.split('.').collect();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || part.len() > 9
                || (part.len() > 1 && part.starts_with('0'))
                || !part.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err(error("Plugin version must have three numeric components"));
    }
    if manifest.api_version != API_VERSION {
        return Err(error("Unsupported plugin API version"));
    }
    if manifest
        .capabilities
        .iter()
        .any(|value| !matches!(value.as_str(), "editor" | "notes" | "browser"))
    {
        return Err(error("Unknown plugin capability"));
    }
    let unique: std::collections::HashSet<_> = manifest.capabilities.iter().collect();
    if unique.len() != manifest.capabilities.len() {
        return Err(error("Duplicate plugin capability"));
    }
    Ok(())
}

fn validate_locales(manifest: &PluginManifest) -> Result<(), AppError> {
    let dictionaries = manifest
        .locales
        .as_object()
        .ok_or_else(|| error("Invalid plugin locales"))?;
    if !dictionaries
        .get(&manifest.default_locale)
        .is_some_and(serde_json::Value::is_object)
    {
        return Err(error("Missing plugin default locale"));
    }
    fn validate_messages(value: &serde_json::Value, depth: usize) -> Result<(), AppError> {
        let object = value
            .as_object()
            .ok_or_else(|| error("Invalid plugin dictionary"))?;
        if depth > 16 {
            return Err(error("Plugin dictionary is too deep"));
        }
        for (key, entry) in object {
            if key.is_empty()
                || !key.as_bytes()[0].is_ascii_alphabetic()
                || matches!(key.as_str(), "__proto__" | "constructor" | "prototype")
                || !key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
            {
                return Err(error("Invalid plugin dictionary key"));
            }
            if !entry.is_string() {
                validate_messages(entry, depth + 1)?;
            }
        }
        Ok(())
    }
    for (locale, dictionary) in dictionaries {
        let bytes = locale.as_bytes();
        if bytes.len() != 5
            || !bytes[..2].iter().all(u8::is_ascii_lowercase)
            || bytes[2] != b'_'
            || !bytes[3..].iter().all(u8::is_ascii_uppercase)
        {
            return Err(error("Invalid plugin locale"));
        }
        validate_messages(dictionary, 0)?;
    }
    for locale in ["en_US", "ru_RU", "es_AR", "tr_TR"] {
        if !dictionaries.contains_key(locale) {
            return Err(error(format!("Missing plugin locale: {locale}")));
        }
    }
    fn signature(value: &serde_json::Value) -> serde_json::Value {
        if let Some(text) = value.as_str() {
            let placeholders = regex::Regex::new(r"\{([A-Za-z0-9_]+)\}")
                .expect("valid placeholder pattern")
                .captures_iter(text)
                .map(|capture| capture[1].to_string())
                .collect::<std::collections::BTreeSet<_>>();
            return serde_json::json!(placeholders);
        }
        serde_json::Value::Object(
            value
                .as_object()
                .expect("validated dictionary")
                .iter()
                .map(|(key, entry)| (key.clone(), signature(entry)))
                .collect(),
        )
    }
    let expected = signature(&dictionaries["en_US"]);
    if dictionaries
        .values()
        .any(|dictionary| signature(dictionary) != expected)
    {
        return Err(error("Plugin locale structure or placeholders differ"));
    }
    Ok(())
}

fn validate_icons(manifest: &PluginManifest) -> Result<(), AppError> {
    if let Some(icons) = &manifest.icons {
        let map = icons
            .get("icons")
            .and_then(serde_json::Value::as_object)
            .ok_or_else(|| error("Invalid plugin icons"))?;
        if map.len() > 4096 {
            return Err(error("Too many plugin icons"));
        }
        let prefix = icons
            .get("prefix")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| error("Invalid plugin icon prefix"))?;
        if prefix.is_empty()
            || !prefix.as_bytes()[0].is_ascii_lowercase()
            || !prefix
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err(error("Invalid plugin icon prefix"));
        }
        let unsafe_svg = regex::Regex::new(r"(?i)<\s*(script|foreignObject|iframe|image|style|a)\b|\bon[a-z0-9_-]+\s*=|(?:href|url)\s*[=(]|javascript:|https?:|data:")
            .map_err(|_| error("Invalid plugin icon validator"))?;
        for (name, icon) in map {
            let body = icon
                .get("body")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| error("Invalid plugin icon"))?;
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
                || body.len() > 128 * 1024
                || unsafe_svg.is_match(body)
            {
                return Err(error("Unsafe plugin icon"));
            }
            for dimension in [
                icons.get("width"),
                icons.get("height"),
                icon.get("width"),
                icon.get("height"),
            ]
            .into_iter()
            .flatten()
            {
                if !dimension
                    .as_f64()
                    .is_some_and(|number| number.is_finite() && number > 0.0 && number <= 4096.0)
                {
                    return Err(error("Invalid plugin icon dimensions"));
                }
            }
        }
    }
    Ok(())
}

fn validate_config_fields(config: &serde_json::Value) -> Result<&[serde_json::Value], AppError> {
    let fields = config
        .get("fields")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| error("Invalid plugin config"))?;
    if fields.len() > 256 {
        return Err(error("Too many plugin fields"));
    }
    let mut names = std::collections::HashSet::new();
    for field in fields {
        let name = field
            .get("name")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| error("Invalid plugin field name"))?;
        if name.is_empty()
            || !name.as_bytes()[0].is_ascii_alphabetic()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
            || matches!(name, "constructor" | "prototype")
            || !names.insert(name)
        {
            return Err(error("Invalid plugin field name"));
        }
        if !matches!(
            field.get("type").and_then(serde_json::Value::as_str),
            Some("text" | "textarea" | "select" | "checkbox" | "sortable-checklist")
        ) {
            return Err(error("Invalid plugin field type"));
        }
        let field_type = field
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap();
        if let Some(options) = field.get("options") {
            let options = options
                .as_array()
                .ok_or_else(|| error("Invalid plugin field options"))?;
            let mut option_ids = std::collections::HashSet::new();
            for option in options {
                let id = option
                    .get("id")
                    .ok_or_else(|| error("Invalid plugin option"))?;
                if !(id.is_string()
                    || id.as_f64().is_some_and(|number| {
                        number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_991.0
                    }))
                    || !option_ids.insert(format!("{}:{}", id.is_string(), option_identity(id)))
                {
                    return Err(error("Invalid plugin option"));
                }
            }
        }
        let default = field.get("defaultValue");
        if field_type == "checkbox" && !default.is_some_and(serde_json::Value::is_boolean) {
            return Err(error("Invalid checkbox default"));
        }
        if field_type == "select" {
            let options = field
                .get("options")
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| error("Select fields require options"))?;
            if !default.is_some_and(|value| {
                options.iter().any(|option| {
                    option.get("id").is_some_and(|id| {
                        option_identity(id) == option_identity(value)
                            && id.is_string() == value.is_string()
                    })
                })
            }) {
                return Err(error("Invalid select default"));
            }
        }
        for key in ["value", "defaultValue"] {
            if field
                .get(key)
                .is_some_and(|value| !valid_field_value(field, value, false))
            {
                return Err(error(format!("Invalid plugin field {key}")));
            }
        }
    }
    Ok(fields)
}

fn validate_presets(
    config: &serde_json::Value,
    fields: &[serde_json::Value],
) -> Result<(), AppError> {
    if let Some(presets) = config.get("presets") {
        let presets = presets
            .as_object()
            .ok_or_else(|| error("Invalid plugin presets"))?;
        for (selector, choices) in presets {
            let selector_field = fields
                .iter()
                .find(|field| {
                    field.get("name").and_then(serde_json::Value::as_str) == Some(selector.as_str())
                })
                .ok_or_else(|| error("Invalid preset selector"))?;
            if selector_field
                .get("type")
                .and_then(serde_json::Value::as_str)
                != Some("select")
            {
                return Err(error("Preset selector must be a select field"));
            }
            let options = selector_field
                .get("options")
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| error("Preset selector has no options"))?;
            let choices = choices
                .as_object()
                .ok_or_else(|| error("Invalid preset choices"))?;
            for (choice, values) in choices {
                if !options.iter().any(|option| {
                    option
                        .get("id")
                        .is_some_and(|id| option_identity(id) == choice.as_str())
                }) {
                    return Err(error("Unknown plugin preset"));
                }
                let values = values
                    .as_object()
                    .ok_or_else(|| error("Invalid plugin preset values"))?;
                for (name, value) in values {
                    if matches!(name.as_str(), "__proto__" | "constructor" | "prototype") {
                        return Err(error("Unsafe plugin preset field"));
                    }
                    let field = fields
                        .iter()
                        .find(|field| {
                            field.get("name").and_then(serde_json::Value::as_str)
                                == Some(name.as_str())
                        })
                        .ok_or_else(|| error("Unknown plugin preset field"))?;
                    let valid = valid_field_value(field, value, true);
                    if !valid {
                        return Err(error("Invalid plugin preset value"));
                    }
                }
            }
        }
    }
    Ok(())
}

fn option_identity(value: &serde_json::Value) -> String {
    value.as_str().map(str::to_owned).unwrap_or_else(|| {
        value
            .as_f64()
            .map_or_else(|| value.to_string(), |number| number.to_string())
    })
}
fn valid_field_value(field: &serde_json::Value, value: &serde_json::Value, preset: bool) -> bool {
    match field["type"].as_str().unwrap_or_default() {
        "checkbox" => value.is_boolean(),
        "textarea" => value.is_string(),
        "select" => field["options"].as_array().is_some_and(|options| {
            options.iter().any(|option| {
                option_identity(&option["id"]) == option_identity(value)
                    && option["id"].is_string() == value.is_string()
            })
        }),
        "sortable-checklist" => value.as_array().is_some_and(|items| {
            items
                .iter()
                .all(|item| item["id"].is_string() && item["enabled"].is_boolean())
        }),
        "text" => {
            value.is_string()
                || ((!preset || field["defaultValue"].is_number())
                    && value.as_f64().is_some_and(f64::is_finite))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> PluginManifest {
        serde_json::from_value(serde_json::json!({"id":"example", "version":"1.0.0", "apiVersion":2, "capabilities":["editor"], "defaultLocale":"en_US", "locales":{"en_US":{},"ru_RU":{},"es_AR":{},"tr_TR":{}}})).unwrap()
    }
    #[test]
    fn matches_sdk_manifest_fixtures() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/plugin-sdk/src/test-fixtures/manifests.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let result = serde_json::from_value::<PluginManifest>(case["manifest"].clone())
                .map_err(AppError::from)
                .and_then(|manifest| validate_manifest(&manifest));
            assert_eq!(
                result.is_ok(),
                case["valid"].as_bool().unwrap(),
                "{}: {result:?}",
                case["name"]
            );
        }
    }
    #[test]
    fn rejects_incomplete_or_mismatched_plugin_locales() {
        let mut missing = manifest();
        missing.locales.as_object_mut().unwrap().remove("tr_TR");
        assert!(validate_manifest(&missing).is_err());
        let mut mismatched = manifest();
        mismatched.locales = serde_json::json!({
            "en_US":{"label":"Hello {name}"}, "ru_RU":{"label":"Hello {user}"},
            "es_AR":{"label":"Hello {name}"}, "tr_TR":{"label":"Hello {name}"}
        });
        assert!(validate_manifest(&mismatched).is_err());
        mismatched.locales["ru_RU"] = serde_json::json!({"label":"{name}, hello {name}"});
        assert!(validate_manifest(&mismatched).is_ok());
    }

    #[test]
    fn rejects_incompatible_and_unsafe_manifests() {
        for id in ["../escape", "core", "x.y", "", "/tmp/plugin"] {
            let mut value = manifest();
            value.id = id.into();
            assert!(validate_manifest(&value).is_err());
        }
        let mut value = manifest();
        value.api_version = 3;
        assert!(validate_manifest(&value).is_err());
        value = manifest();
        value.capabilities.push("shell".into());
        assert!(validate_manifest(&value).is_err());
    }

    #[test]
    fn rejects_active_icons_and_accepts_bundled_paths() {
        let mut value = manifest();
        value.icons = Some(serde_json::json!({
            "prefix": "example",
            "icons": {"sample": {"body": "<path d=\"M0 0h1v1z\"/>"}}
        }));
        assert!(validate_manifest(&value).is_ok());
        for body in [
            "<script/>",
            "<path onclick=\"run()\"/>",
            "<image href=\"https://example.com\"/>",
        ] {
            value.icons.as_mut().unwrap()["icons"]["sample"]["body"] = body.into();
            assert_eq!(
                validate_manifest(&value).unwrap_err().to_string(),
                "Unsafe plugin icon"
            );
        }
    }

    #[test]
    fn validates_fields_before_presets_and_checks_preset_values() {
        let mut value = manifest();
        value.default_config = Some(serde_json::json!({
            "fields": [
                {"name": "mode", "type": "select", "defaultValue": "basic", "options": [{"id": "basic"}]},
                {"name": "flag", "type": "checkbox", "defaultValue": false}
            ],
            "presets": {"mode": {"basic": {"flag": true}}}
        }));
        assert!(validate_manifest(&value).is_ok());

        let config = value.default_config.as_mut().unwrap();
        config["fields"][1]["defaultValue"] = "invalid".into();
        config["presets"]["mode"]["basic"]["flag"] = "invalid".into();
        assert_eq!(
            validate_manifest(&value).unwrap_err().to_string(),
            "Invalid checkbox default"
        );

        value.default_config.as_mut().unwrap()["fields"][1]["defaultValue"] = false.into();
        assert_eq!(
            validate_manifest(&value).unwrap_err().to_string(),
            "Invalid plugin preset value"
        );

        value.default_config.as_mut().unwrap()["presets"] =
            serde_json::json!({"mode": {"unknown": {}}});
        assert_eq!(
            validate_manifest(&value).unwrap_err().to_string(),
            "Unknown plugin preset"
        );
    }
}
