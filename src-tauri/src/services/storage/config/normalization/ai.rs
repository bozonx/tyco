use crate::models::default_user_config;
use serde_json::{json, Value};

/// Gives every AI task without one a stable `id`, `task-<n>`, which the main
/// action menu refers to the task by. Empty slots stay empty.
fn assign_ai_task_ids(tasks: &mut [Value]) -> bool {
    let has_id = |task: &Value| {
        task.get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.trim().is_empty())
    };
    let mut used: Vec<String> = tasks
        .iter()
        .filter(|task| has_id(task))
        .filter_map(|task| task["id"].as_str().map(str::to_owned))
        .collect();
    let mut changed = false;
    for task in tasks.iter_mut() {
        if has_id(task) {
            continue;
        }
        let Some(fields) = task.as_object_mut() else {
            continue;
        };
        let id = (1..)
            .map(|n| format!("task-{n}"))
            .find(|id| !used.contains(id))
            .unwrap_or_default();
        fields.insert(String::from("id"), Value::String(id.clone()));
        used.push(id);
        changed = true;
    }
    changed
}

pub(in crate::services::storage::config) fn normalize_ai_rules_and_tasks(
    user_config: &mut Value,
) -> bool {
    let defaults = default_user_config();
    let default_rules = &defaults["aiRules"];
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    if config.remove("chatRoles").is_some() {
        changed = true;
    }

    if let Some(rules) = config.get_mut("aiRules").and_then(Value::as_object_mut) {
        // the common rule was replaced by per-task rules
        if rules.remove("base").is_some() {
            changed = true;
        }
        if let Some(def_rules) = default_rules.as_object() {
            for (key, default_val) in def_rules {
                if rules.get(key).and_then(Value::as_str).is_none() {
                    rules.insert(key.clone(), default_val.clone());
                    changed = true;
                }
            }
        }
    } else {
        config.insert(String::from("aiRules"), default_rules.clone());
        changed = true;
    }

    match config.get_mut("aiTasks").and_then(Value::as_array_mut) {
        Some(tasks) => changed |= assign_ai_task_ids(tasks),
        None => {
            config.insert(String::from("aiTasks"), defaults["aiTasks"].clone());
            changed = true;
        }
    }

    if config.get("plugins").and_then(Value::as_object).is_none() {
        config.insert(String::from("plugins"), json!({}));
        changed = true;
    }

    changed
}
