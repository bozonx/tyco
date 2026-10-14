use serde_json::Value;

/// Gives every AI task without one a stable `id`, `task-<n>`, which the main
/// action menu refers to the task by. Empty slots stay empty. The schema would
/// drop a task without an id, so this runs before it.
pub(in crate::services::storage::config) fn normalize_ai_task_ids(user_config: &mut Value) -> bool {
    let Some(tasks) = user_config.get_mut("aiTasks").and_then(Value::as_array_mut) else {
        return false;
    };
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
