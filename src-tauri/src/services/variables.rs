//! Variables of the commands: a name the user data declares once
//! (`variables`), a value each device sets on its own (`variableValues`).
//! A template refers to one as `{{var:NAME}}`; see `variables.ts` of
//! `@tyco/shared`, which follows the same rules, and the shared fixtures that
//! check both.
//!
//! Nested variable references are resolved before escaping. Text and selection
//! placeholders inside values stay literal. A variable without a value on this device stops
//! the run instead of leaving an empty string in its place.
use std::collections::{BTreeMap, HashSet};
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::errors::AppError;

/// The prefix of the built-in variables; a variable of the user never has it.
pub const BUILTIN_PREFIX: &str = "TYCO_";
/// The prefix a variable of the user takes in the environment of a script,
/// so that it never stands in for a variable of the system (`PATH`, …).
pub const ENV_PREFIX: &str = "TYCO_VAR_";
/// The user data folder.
pub const USER_DIR: &str = "TYCO_USER_DIR";
/// The id of this device.
pub const DEVICE_ID: &str = "TYCO_DEVICE_ID";

static REFERENCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{\{var:([A-Za-z_][A-Za-z0-9_]*)\}\}").expect("valid variable pattern")
});

/// What a template is filled for: the escaping of a value depends on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Place {
    /// A prompt, a working directory: the value as it is.
    Text,
    /// A URL, e.g. the base URL of a provider: the value as it is, so that
    /// it may hold a base address; the URL is checked as a whole after.
    Url,
    /// The value of an HTTP header: as it is, without a line break.
    Header,
}

impl Place {
    #[cfg(test)]
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "text" => Some(Self::Text),
            "url" => Some(Self::Url),
            "header" => Some(Self::Header),
            _ => None,
        }
    }
}

/// The values the variables have on this device, by name, the built-in ones
/// included. A variable without a value is not there.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct VariableValues {
    user: BTreeMap<String, String>,
    builtin: BTreeMap<String, String>,
}

#[derive(Default)]
struct Resolution {
    values: BTreeMap<String, String>,
    missing: Vec<String>,
    cycles: Vec<String>,
}

/// What the built-in variables stand for on this device.
pub struct Builtins<'a> {
    pub user_dir: &'a str,
    pub device_id: &'a str,
}

impl VariableValues {
    /// The values of `config`, joined by the backend: each declared variable
    /// with the value this device set for it.
    pub fn of(config: &Value, builtins: &Builtins) -> Self {
        let values = &config["variableValues"];
        let user = config["variables"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|variable| {
                let name = variable["name"].as_str()?;
                let value = values[variable["id"].as_str()?].as_str()?;
                (!value.trim().is_empty()).then(|| (name.to_owned(), value.to_owned()))
            })
            .collect();
        let builtin = [
            (USER_DIR, builtins.user_dir),
            (DEVICE_ID, builtins.device_id),
        ]
        .into_iter()
        .filter(|(_, value)| !value.is_empty())
        .map(|(name, value)| (name.to_owned(), value.to_owned()))
        .collect();
        Self { user, builtin }
    }

    /// Values by name, for tests.
    #[cfg(test)]
    pub fn from_pairs(pairs: &[(&str, &str)]) -> Self {
        let mut values = Self::default();
        for (name, value) in pairs {
            let map = if name.starts_with(BUILTIN_PREFIX) {
                &mut values.builtin
            } else {
                &mut values.user
            };
            map.insert((*name).to_owned(), (*value).to_owned());
        }
        values
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.builtin
            .get(name)
            .or_else(|| self.user.get(name))
            .map(String::as_str)
    }

    /// The name a variable has in the environment of a script.
    pub fn env_name(name: &str) -> String {
        if name.starts_with(BUILTIN_PREFIX) {
            name.to_owned()
        } else {
            format!("{ENV_PREFIX}{name}")
        }
    }

    /// Resolve only the requested dependencies; built-in values stay literal.
    fn resolve_names(&self, names: &[&str]) -> Resolution {
        let mut result = Resolution::default();
        let mut visiting = HashSet::new();
        let mut visited = HashSet::new();
        for name in names {
            self.visit(name, &mut visiting, &mut visited, &mut result);
        }
        result
    }

    fn visit(
        &self,
        name: &str,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
        result: &mut Resolution,
    ) {
        if visiting.contains(name) {
            if !result.cycles.iter().any(|item| item == name) {
                result.cycles.push(name.to_owned());
            }
            return;
        }
        if !visited.insert(name.to_owned()) {
            return;
        }
        let Some(value) = self.get(name) else {
            result.missing.push(name.to_owned());
            return;
        };
        if name.starts_with(BUILTIN_PREFIX) {
            result.values.insert(name.to_owned(), value.to_owned());
            return;
        }
        visiting.insert(name.to_owned());
        let dependencies = references(value);
        for dependency in &dependencies {
            self.visit(dependency, visiting, visited, result);
        }
        visiting.remove(name);
        if dependencies
            .iter()
            .all(|dependency| result.values.contains_key(*dependency))
        {
            let value = REFERENCE
                .replace_all(value, |captures: &regex::Captures| {
                    result.values.get(&captures[1]).cloned().unwrap_or_default()
                })
                .into_owned();
            result.values.insert(name.to_owned(), value);
        }
    }

    /// A nested value, absent when a dependency is missing or cyclic.
    pub fn resolve(&self, name: &str) -> Option<String> {
        self.resolve_names(&[name]).values.remove(name)
    }

    /// The environment of a script: every successfully resolved variable.
    pub fn env(&self) -> Vec<(String, String)> {
        self.builtin
            .iter()
            .chain(&self.user)
            .filter_map(|(name, _)| {
                self.resolve(name)
                    .map(|value| (Self::env_name(name), value))
            })
            .collect()
    }
}

/// The names `template` refers to, each once, in their order.
pub fn references(template: &str) -> Vec<&str> {
    let mut seen = HashSet::new();
    REFERENCE
        .captures_iter(template)
        .filter_map(|captures| captures.get(1).map(|name| name.as_str()))
        .filter(|name| seen.insert(*name))
        .collect()
}

/// Missing dependencies and cyclic references, each once.
#[cfg(test)]
pub fn missing<'a>(
    templates: impl IntoIterator<Item = &'a str>,
    values: &VariableValues,
) -> Vec<String> {
    let names: Vec<&str> = templates.into_iter().flat_map(references).collect();
    let result = values.resolve_names(&names);
    result.missing.into_iter().chain(result.cycles).collect()
}

/// The error of a run that refers to variables without a value here.
pub fn not_set_error(names: &[String]) -> AppError {
    AppError::VariableNotSet(format!(
        "Set the value of {} on this device: {}",
        if names.len() == 1 {
            "the variable"
        } else {
            "the variables"
        },
        names.join(", ")
    ))
}

/// `template` with every variable filled for `place`.
pub fn substitute(
    template: &str,
    values: &VariableValues,
    place: Place,
) -> Result<String, AppError> {
    let resolved = values.resolve_names(&references(template));
    if !resolved.cycles.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "Cyclic variable references: {}",
            resolved.cycles.join(", ")
        )));
    }
    if !resolved.missing.is_empty() {
        return Err(not_set_error(&resolved.missing));
    }
    if place == Place::Header {
        if let Some(name) = references(template).into_iter().find(|name| {
            resolved
                .values
                .get(*name)
                .is_some_and(|value| value.contains(['\r', '\n']))
        }) {
            return Err(AppError::InvalidInput(format!(
                "The value of the variable {name} has a line break and cannot go into a header"
            )));
        }
    }
    Ok(REFERENCE
        .replace_all(template, |captures: &regex::Captures| {
            resolved
                .values
                .get(&captures[1])
                .cloned()
                .unwrap_or_default()
        })
        .into_owned())
}

/// The placeholder of the variable `name`.
pub fn placeholder(name: &str) -> String {
    format!("{{{{var:{name}}}}}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn values_come_from_the_declarations_and_the_device() {
        let config = json!({
            "variables": [
                {"id": "notes", "name": "NOTES_DIR"},
                {"id": "api", "name": "LOCAL_API"},
                {"id": "blank", "name": "BLANK"}
            ],
            "variableValues": {"notes": "/n", "blank": "  ", "gone": "x"}
        });
        let values = VariableValues::of(
            &config,
            &Builtins {
                user_dir: "/sync/tyco",
                device_id: "d1",
            },
        );
        assert_eq!(values.get("NOTES_DIR"), Some("/n"));
        assert_eq!(values.get("LOCAL_API"), None);
        assert_eq!(values.get("BLANK"), None);
        assert_eq!(values.get(USER_DIR), Some("/sync/tyco"));
        assert_eq!(
            values.env(),
            vec![
                (String::from("TYCO_DEVICE_ID"), String::from("d1")),
                (String::from("TYCO_USER_DIR"), String::from("/sync/tyco")),
                (String::from("TYCO_VAR_NOTES_DIR"), String::from("/n")),
            ]
        );
    }

    #[test]
    fn script_environment_resolves_dependencies_and_omits_invalid_values() {
        let values = VariableValues::from_pairs(&[
            ("ROOT", "/a b"),
            ("CHILD", "{{var:ROOT}}/notes"),
            ("CYCLE", "{{var:CYCLE}}"),
            ("MISSING", "{{var:UNSET}}"),
        ]);
        assert_eq!(
            values.env(),
            vec![
                ("TYCO_VAR_CHILD".to_owned(), "/a b/notes".to_owned()),
                ("TYCO_VAR_ROOT".to_owned(), "/a b".to_owned()),
            ]
        );
    }

    #[test]
    fn a_missing_variable_stops_the_substitution_and_is_named() {
        let values = VariableValues::from_pairs(&[("A", "1")]);
        let error = substitute("{{var:A}}/{{var:B}}/{{var:B}}", &values, Place::Url).unwrap_err();
        assert!(matches!(&error, AppError::VariableNotSet(message) if message.ends_with(": B")));
        assert_eq!(
            missing(["{{var:A}} {{var:C}}", "{{var:B}}"], &values),
            ["C", "B"]
        );
    }

    /// The cases of `packages/shared/fixtures/variable-substitution.json` the
    /// backend fills: those without the text of a run and of its places.
    #[test]
    fn shared_substitution_fixtures_match_the_webview() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../packages/shared/fixtures/variable-substitution.json"
        ))
        .unwrap();
        let mut count = 0;
        for case in cases {
            let name = &case["name"];
            let Some(place) = case["place"].as_str().and_then(Place::parse) else {
                continue;
            };
            if case.get("text").is_some() {
                continue;
            }
            let pairs: Vec<(String, String)> = case["values"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(name, value)| (name.clone(), value.as_str().unwrap().to_owned()))
                .collect();
            let pairs: Vec<(&str, &str)> = pairs
                .iter()
                .map(|(name, value)| (name.as_str(), value.as_str()))
                .collect();
            let values = VariableValues::from_pairs(&pairs);
            let template = case["template"].as_str().unwrap();
            let result = substitute(template, &values, place);
            if let Some(expected) = case["expected"].as_str() {
                assert_eq!(result.unwrap(), expected, "{name}");
            } else if case.get("cycles").is_some() {
                assert!(matches!(result, Err(AppError::InvalidInput(_))), "{name}");
            } else if let Some(names) = case["missing"].as_array() {
                let names: Vec<&str> = names.iter().filter_map(Value::as_str).collect();
                assert_eq!(missing([template], &values), names, "{name}");
                assert!(matches!(result, Err(AppError::VariableNotSet(_))), "{name}");
            } else {
                assert!(matches!(result, Err(AppError::InvalidInput(_))), "{name}");
            }
            count += 1;
        }
        assert!(count > 0);
    }
}
