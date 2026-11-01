//! Three-way config updates: independent edits in different windows survive.
//! Objects merge field by field. Arrays of entities, each with its own `id`,
//! merge entity by entity, so that editing two commands in two windows does
//! not conflict; any other array is one value.
use serde_json::{Map, Value};

use crate::errors::AppError;

/// What a merge does when both sides changed the same field differently.
enum Conflicts<'a> {
    /// Refuses the merge: two windows of one device must not overwrite each
    /// other silently.
    Reject,
    /// Takes `next` and records the path: the change the user has just made
    /// on this device wins over the one another device synced.
    PreferNext(&'a mut Vec<String>),
}

pub fn merge_config(current: &Value, base: &Value, next: &Value) -> Result<Value, AppError> {
    merge_root(current, base, next, &mut Conflicts::Reject)
}

/// Merges the changes of this device, `next`, with those another device
/// made meanwhile, `current` (the file on the disk), both since `base`. A
/// field both changed takes the value of `next`; the paths of such fields
/// are returned with the result.
pub fn merge_preferring_next(
    current: &Value,
    base: &Value,
    next: &Value,
) -> Result<(Value, Vec<String>), AppError> {
    let mut conflicts = Vec::new();
    let merged = merge_root(
        current,
        base,
        next,
        &mut Conflicts::PreferNext(&mut conflicts),
    )?;
    Ok((merged, conflicts))
}

fn merge_root(
    current: &Value,
    base: &Value,
    next: &Value,
    conflicts: &mut Conflicts,
) -> Result<Value, AppError> {
    if !current.is_object() || !base.is_object() || !next.is_object() {
        return Err(AppError::InvalidInput(
            "The user config must be an object".into(),
        ));
    }
    merge(
        Some(current),
        Some(base),
        Some(next),
        "userConfig",
        conflicts,
    )?
    .ok_or_else(|| AppError::InvalidInput("The user config cannot be removed".into()))
}

/// Resolves a conflict at `path`: an error, or the value of `next`.
fn resolve(
    next: Option<&Value>,
    path: &str,
    conflicts: &mut Conflicts,
) -> Result<Option<Value>, AppError> {
    match conflicts {
        Conflicts::Reject => Err(conflict(path)),
        Conflicts::PreferNext(paths) => {
            paths.push(path.to_owned());
            Ok(next.cloned())
        }
    }
}

fn merge(
    current: Option<&Value>,
    base: Option<&Value>,
    next: Option<&Value>,
    path: &str,
    conflicts: &mut Conflicts,
) -> Result<Option<Value>, AppError> {
    if base == next || current == next {
        return Ok(current.cloned());
    }
    if current == base {
        return Ok(next.cloned());
    }
    match (current, base, next) {
        (Some(Value::Object(current)), Some(Value::Object(base)), Some(Value::Object(next))) => {
            merge_objects(current, base, next, path, conflicts)
                .map(|fields| Some(Value::Object(fields)))
        }
        (
            Some(Value::Array(current_items)),
            Some(Value::Array(base_items)),
            Some(Value::Array(next_items)),
        ) => {
            match (
                entities(current_items),
                entities(base_items),
                entities(next_items),
            ) {
                (Some(current_entities), Some(base_entities), Some(next_entities)) => {
                    merge_entities(
                        &current_entities,
                        &base_entities,
                        &next_entities,
                        path,
                        conflicts,
                    )
                    .map(|items| Some(Value::Array(items)))
                }
                _ => resolve(next, path, conflicts),
            }
        }
        _ => resolve(next, path, conflicts),
    }
}

fn conflict(path: &str) -> AppError {
    AppError::ConfigConflict(format!(
        "Configuration changed in another window: {path}. Reopen settings before saving this field"
    ))
}

/// The keys of all three in the order of `current`, then the new ones of
/// `next`: a merge keeps the order the file has.
fn ordered_keys(sources: [&Map<String, Value>; 3]) -> Vec<&String> {
    let mut keys: Vec<&String> = Vec::new();
    for source in sources {
        for key in source.keys() {
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
    }
    keys
}

fn merge_objects(
    current: &Map<String, Value>,
    base: &Map<String, Value>,
    next: &Map<String, Value>,
    path: &str,
    conflicts: &mut Conflicts,
) -> Result<Map<String, Value>, AppError> {
    let mut result = Map::new();
    for key in ordered_keys([current, next, base]) {
        if let Some(value) = merge(
            current.get(key),
            base.get(key),
            next.get(key),
            &format!("{path}.{key}"),
            conflicts,
        )? {
            result.insert(key.clone(), value);
        }
    }
    Ok(result)
}

/// The items keyed by their `id`, or `None` when the array is not a list of
/// entities with distinct ids.
fn entities(items: &[Value]) -> Option<Vec<(&str, &Value)>> {
    let mut result: Vec<(&str, &Value)> = Vec::with_capacity(items.len());
    for item in items {
        let id = item.get("id")?.as_str()?;
        if result.iter().any(|(seen, _)| *seen == id) {
            return None;
        }
        result.push((id, item));
    }
    Some(result)
}

fn find<'a>(items: &[(&str, &'a Value)], id: &str) -> Option<&'a Value> {
    items
        .iter()
        .find(|(item_id, _)| *item_id == id)
        .map(|(_, item)| *item)
}

fn ids<'a>(items: &[(&'a str, &Value)]) -> Vec<&'a str> {
    items.iter().map(|(id, _)| *id).collect()
}

/// `order` without the items the merge dropped.
fn kept<'a>(order: Vec<&'a str>, merged_ids: &[&str]) -> Vec<&'a str> {
    order
        .into_iter()
        .filter(|id| merged_ids.contains(id))
        .collect()
}

/// The items of `base` in the order a side has them.
fn in_base<'a>(order: &[&'a str], base_order: &[&str]) -> Vec<&'a str> {
    order
        .iter()
        .copied()
        .filter(|id| base_order.contains(id))
        .collect()
}

/// Whether a side changed the order of the items it shares with `base`.
fn is_moved(order: &[&str], base_order: &[&str]) -> bool {
    let shared_in_base: Vec<&str> = base_order
        .iter()
        .copied()
        .filter(|id| order.contains(id))
        .collect();
    in_base(order, base_order) != shared_in_base
}

fn merge_entities(
    current: &[(&str, &Value)],
    base: &[(&str, &Value)],
    next: &[(&str, &Value)],
    path: &str,
    conflicts: &mut Conflicts,
) -> Result<Vec<Value>, AppError> {
    let mut merged: Vec<(&str, Value)> = Vec::new();
    for (id, _) in current.iter().chain(next).chain(base) {
        if merged.iter().any(|(seen, _)| seen == id) {
            continue;
        }
        if let Some(value) = merge(
            find(current, id),
            find(base, id),
            find(next, id),
            &format!("{path}[{id}]"),
            conflicts,
        )? {
            merged.push((id, value));
        }
    }
    // The order is one more field: the side that moved items decides it.
    let merged_ids: Vec<&str> = merged.iter().map(|(id, _)| *id).collect();
    let base_order = kept(ids(base), &merged_ids);
    let current_order = kept(ids(current), &merged_ids);
    let next_order = kept(ids(next), &merged_ids);
    let current_moved = is_moved(&current_order, &base_order);
    let next_moved = is_moved(&next_order, &base_order);
    let orders_conflict = current_moved
        && next_moved
        && in_base(&current_order, &base_order) != in_base(&next_order, &base_order);
    if orders_conflict {
        match conflicts {
            Conflicts::Reject => return Err(conflict(path)),
            Conflicts::PreferNext(paths) => paths.push(path.to_owned()),
        }
    }
    let leading = if next_moved && (!current_moved || orders_conflict) {
        next_order
    } else {
        current_order
    };
    let mut items = Vec::with_capacity(merged.len());
    for id in leading {
        if let Some(position) = merged.iter().position(|(merged_id, _)| *merged_id == id) {
            items.push(merged.remove(position).1);
        }
    }
    // the items the other side added go after the ones already in place
    items.extend(merged.into_iter().map(|(_, value)| value));
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_change_of_this_device_wins_over_one_from_the_disk() {
        let base = json!({"a": 1, "b": 1, "list": [{"id": "x", "v": 1}]});
        let disk = json!({"a": 2, "b": 2, "list": [{"id": "x", "v": 2}]});
        let local = json!({"a": 3, "b": 1, "list": [{"id": "x", "v": 3}]});
        let (merged, conflicts) = merge_preferring_next(&disk, &base, &local).unwrap();
        assert_eq!(
            merged,
            json!({"a": 3, "b": 2, "list": [{"id": "x", "v": 3}]})
        );
        assert_eq!(conflicts, ["userConfig.a", "userConfig.list[x].v"]);
    }

    #[test]
    fn independent_changes_of_the_disk_and_this_device_merge() {
        let base = json!({"a": 1, "b": 1, "list": [{"id": "x"}]});
        let disk = json!({"a": 2, "b": 1, "list": [{"id": "x"}, {"id": "y"}]});
        let local = json!({"a": 1, "b": 3, "list": [{"id": "x"}, {"id": "z"}]});
        let (merged, conflicts) = merge_preferring_next(&disk, &base, &local).unwrap();
        assert_eq!(
            merged,
            json!({"a": 2, "b": 3, "list": [{"id": "x"}, {"id": "y"}, {"id": "z"}]})
        );
        assert!(conflicts.is_empty());
    }

    #[test]
    fn different_reorderings_take_the_order_of_this_device() {
        let base = json!({"list": [{"id": "a"}, {"id": "b"}, {"id": "c"}]});
        let disk = json!({"list": [{"id": "c"}, {"id": "a"}, {"id": "b"}]});
        let local = json!({"list": [{"id": "b"}, {"id": "a"}, {"id": "c"}]});
        let (merged, conflicts) = merge_preferring_next(&disk, &base, &local).unwrap();
        assert_eq!(merged, local);
        assert_eq!(conflicts, ["userConfig.list"]);
    }

    #[test]
    fn independent_nested_edits_and_removals_survive() {
        let base =
            json!({"llm":{"models":[],"name":"old"},"legacy":true,"appearance":{"theme":"light"}});
        let current = json!({"llm":{"models":["new"],"name":"old"},"legacy":true,"appearance":{"theme":"dark"}});
        let next = json!({"llm":{"models":[],"name":"mine"},"appearance":{"theme":"light"}});
        assert_eq!(
            merge_config(&current, &base, &next).unwrap(),
            json!({"llm":{"models":["new"],"name":"mine"},"appearance":{"theme":"dark"}})
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
            assert!(matches!(
                merge_config(&current, &base, &next),
                Err(AppError::ConfigConflict(_))
            ));
        }
    }

    #[test]
    fn edits_of_different_entities_merge() {
        let base =
            json!({"commands":[{"id":"a","name":"A"},{"id":"b","name":"B"},{"id":"c","name":"C"}]});
        let current = json!({"commands":[{"id":"a","name":"A2"},{"id":"b","name":"B"},{"id":"c","name":"C"},{"id":"d","name":"D"}]});
        let next = json!({"commands":[{"id":"a","name":"A"},{"id":"b","name":"B3"},{"id":"e","name":"E"}]});
        assert_eq!(
            merge_config(&current, &base, &next).unwrap(),
            json!({"commands":[
                {"id":"a","name":"A2"},
                {"id":"b","name":"B3"},
                {"id":"d","name":"D"},
                {"id":"e","name":"E"},
            ]})
        );
    }

    #[test]
    fn one_side_reorders_entities_while_the_other_edits_them() {
        let base = json!({"pages":[{"id":"a","n":1},{"id":"b","n":1}]});
        let current = json!({"pages":[{"id":"a","n":2},{"id":"b","n":1}]});
        let next = json!({"pages":[{"id":"b","n":1},{"id":"a","n":1}]});
        assert_eq!(
            merge_config(&current, &base, &next).unwrap(),
            json!({"pages":[{"id":"b","n":1},{"id":"a","n":2}]})
        );
    }

    #[test]
    fn the_same_entity_or_different_orders_conflict() {
        let base = json!({"commands":[{"id":"a","name":"A"},{"id":"b","name":"B"}]});
        for (current, next) in [
            (
                json!({"commands":[{"id":"a","name":"A2"},{"id":"b","name":"B"}]}),
                json!({"commands":[{"id":"a","name":"A3"},{"id":"b","name":"B"}]}),
            ),
            (
                json!({"commands":[{"id":"a","name":"A2"},{"id":"b","name":"B"}]}),
                json!({"commands":[{"id":"b","name":"B"}]}),
            ),
        ] {
            assert!(
                matches!(
                    merge_config(&current, &base, &next),
                    Err(AppError::ConfigConflict(_))
                ),
                "{current} / {next}"
            );
        }
    }

    #[test]
    fn different_reorderings_conflict_and_the_same_one_merges() {
        let base = json!({"pages":[{"id":"a"},{"id":"b"},{"id":"c"}]});
        let current = json!({"pages":[{"id":"b"},{"id":"a"},{"id":"c"}]});
        assert!(matches!(
            merge_config(
                &current,
                &base,
                &json!({"pages":[{"id":"a"},{"id":"c"},{"id":"b"}]})
            ),
            Err(AppError::ConfigConflict(_))
        ));
        assert_eq!(
            merge_config(
                &current,
                &base,
                &json!({"pages":[{"id":"b"},{"id":"d"},{"id":"a"},{"id":"c"}]})
            )
            .unwrap(),
            json!({"pages":[{"id":"b"},{"id":"a"},{"id":"c"},{"id":"d"}]})
        );
    }

    #[test]
    fn merged_objects_keep_the_order_of_the_file() {
        let base = json!({"z":1,"a":1});
        let current = json!({"z":2,"a":1});
        let next = json!({"z":1,"a":1,"m":3});
        let merged = merge_config(&current, &base, &next).unwrap();
        let keys: Vec<&String> = merged.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["z", "a", "m"]);
    }

    #[test]
    fn identical_concurrent_edits_are_idempotent_and_invalid_roots_fail() {
        assert_eq!(
            merge_config(&json!({"x":2}), &json!({"x":1}), &json!({"x":2})).unwrap(),
            json!({"x":2})
        );
        assert!(matches!(
            merge_config(&json!({}), &Value::Null, &json!({})),
            Err(AppError::InvalidInput(_))
        ));
    }
}
