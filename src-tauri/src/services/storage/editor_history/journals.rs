//! The editor history as journals, one per device: a device writes only its
//! own and reads them all, so that devices sharing a synced folder never
//! write the same file. A change to an entry of another device is a record
//! in the own journal: the other journal is never rewritten nor removed.
//!
//! A line of a journal is an entry, or one of the events of [`HistoryEvent`].
//! The journals are merged by [`merge_journals`]: an entry written again
//! (moved to the top) replaces the older copy, a `delete` hides its entry,
//! the latest `result` of an entry wins, and the latest `clear` of any
//! journal hides everything before it. The times are the clocks of the
//! devices: a clock that is off moves entries in the order, nothing more.
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::models::EditorHistoryItem;

/// A change to the entries of the history, written into the journal of the
/// device that made it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum HistoryEvent {
    /// The entry `id` is removed.
    Delete { id: String },
    /// The AI result of the entry `id` at `at`; `None` clears it.
    Result {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<String>,
        at: u64,
    },
    /// The user cleared the history: every entry made before `before` goes.
    Clear { before: u64 },
    /// The name of the device of the journal, written when it changes; the
    /// latest one counts.
    Device { name: String },
}

/// A line of a journal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub(super) enum HistoryRecord {
    Event(HistoryEvent),
    Item(EditorHistoryItem),
}

impl HistoryRecord {
    pub(super) fn item(&self) -> Option<&EditorHistoryItem> {
        match self {
            Self::Item(item) => Some(item),
            Self::Event(_) => None,
        }
    }
}

/// The latest name of the device a journal tells.
pub(super) fn device_name(records: &[HistoryRecord]) -> Option<String> {
    records.iter().rev().find_map(|record| match record {
        HistoryRecord::Event(HistoryEvent::Device { name }) => Some(name.clone()),
        _ => None,
    })
}

/// The latest `clear` of all journals.
fn clear_before<'a>(records: impl Iterator<Item = &'a HistoryRecord>) -> u64 {
    records
        .filter_map(|record| match record {
            HistoryRecord::Event(HistoryEvent::Clear { before }) => Some(*before),
            _ => None,
        })
        .max()
        .unwrap_or(0)
}

/// The entries the journals hold together, newest first. `journals` is in a
/// fixed order, so that a tie between two copies of an entry is decided the
/// same way every time: the later journal and line win.
pub(super) fn merge_journals(journals: &[Vec<HistoryRecord>]) -> Vec<EditorHistoryItem> {
    let records = || journals.iter().flatten();
    let cleared = clear_before(records());
    let mut items: HashMap<&str, &EditorHistoryItem> = HashMap::new();
    let mut deleted: HashSet<&str> = HashSet::new();
    let mut results: HashMap<&str, (u64, &Option<String>)> = HashMap::new();
    for record in records() {
        match record {
            HistoryRecord::Item(item) => {
                let newer = items
                    .get(item.id.as_str())
                    .is_none_or(|known| item.created_at_ms >= known.created_at_ms);
                if newer {
                    items.insert(&item.id, item);
                }
            }
            HistoryRecord::Event(HistoryEvent::Delete { id }) => {
                deleted.insert(id);
            }
            HistoryRecord::Event(HistoryEvent::Result { id, result, at }) => {
                let newer = results
                    .get(id.as_str())
                    .is_none_or(|(known, _)| at >= known);
                if newer {
                    results.insert(id, (*at, result));
                }
            }
            HistoryRecord::Event(HistoryEvent::Clear { .. } | HistoryEvent::Device { .. }) => {}
        }
    }
    let mut merged: Vec<EditorHistoryItem> = items
        .into_values()
        .filter(|item| !deleted.contains(item.id.as_str()) && item.created_at_ms >= cleared)
        .map(|item| {
            let mut item = item.clone();
            // a copy written after the result already carries it
            if let Some((at, result)) = results.get(item.id.as_str()) {
                if *at >= item.created_at_ms {
                    item.result = (*result).clone();
                }
            }
            item
        })
        .collect();
    merged.sort_by(|a, b| {
        b.created_at_ms
            .cmp(&a.created_at_ms)
            .then_with(|| b.id.cmp(&a.id))
    });
    merged
}

/// The records that turn the entries `before` into `after`, for the journal
/// of this device. An entry that only got another result is a `result`; any
/// other change writes the entry again.
pub(super) fn changes(
    before: &[EditorHistoryItem],
    after: &[EditorHistoryItem],
    now_ms: u64,
) -> Vec<HistoryRecord> {
    let mut records = Vec::new();
    for item in before {
        if !after.iter().any(|kept| kept.id == item.id) {
            records.push(HistoryRecord::Event(HistoryEvent::Delete {
                id: item.id.clone(),
            }));
        }
    }
    for item in after.iter().rev() {
        match before.iter().find(|known| known.id == item.id) {
            None => records.push(HistoryRecord::Item(item.clone())),
            Some(known) if known == item => {}
            Some(known) => {
                let mut with_result = known.clone();
                with_result.result = item.result.clone();
                records.push(if with_result == *item {
                    HistoryRecord::Event(HistoryEvent::Result {
                        id: item.id.clone(),
                        result: item.result.clone(),
                        at: now_ms.max(item.created_at_ms),
                    })
                } else {
                    HistoryRecord::Item(item.clone())
                });
            }
        }
    }
    records
}

/// What a device keeps of its own journal under the settings: entries no
/// older than `cutoff_ms`, at most `max_entries` of the newest, each once,
/// with `redact` applied; the events that still name an entry of some
/// journal; and its latest `clear`, always. `others` are the journals of the
/// other devices.
pub(super) fn compact(
    own: &[HistoryRecord],
    others: &[Vec<HistoryRecord>],
    cutoff_ms: u64,
    max_entries: usize,
    redact: impl Fn(&mut EditorHistoryItem),
) -> Vec<HistoryRecord> {
    let cleared = clear_before(own.iter().chain(others.iter().flatten()));
    let own_clear = own
        .iter()
        .filter_map(|record| match record {
            HistoryRecord::Event(HistoryEvent::Clear { before }) => Some(*before),
            _ => None,
        })
        .max();

    // the newest copy of each entry, newest entries first
    let mut items: Vec<EditorHistoryItem> = Vec::new();
    for item in own.iter().filter_map(HistoryRecord::item) {
        match items.iter_mut().find(|known| known.id == item.id) {
            Some(known) if item.created_at_ms >= known.created_at_ms => *known = item.clone(),
            Some(_) => {}
            None => items.push(item.clone()),
        }
    }
    items.retain(|item| item.created_at_ms >= cutoff_ms.max(cleared));
    items.sort_by_key(|item| std::cmp::Reverse(item.created_at_ms));
    items.truncate(max_entries);
    for item in &mut items {
        redact(item);
    }

    let mut existing: HashSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
    existing.extend(
        others
            .iter()
            .flatten()
            .filter_map(HistoryRecord::item)
            .filter(|item| item.created_at_ms >= cleared)
            .map(|item| item.id.as_str()),
    );
    let mut latest_results: HashMap<&str, u64> = HashMap::new();
    for record in own {
        if let HistoryRecord::Event(HistoryEvent::Result { id, at, .. }) = record {
            let latest = latest_results.entry(id).or_insert(*at);
            *latest = (*latest).max(*at);
        }
    }

    let mut kept = Vec::new();
    if let Some(name) = device_name(own) {
        kept.push(HistoryRecord::Event(HistoryEvent::Device { name }));
    }
    if let Some(before) = own_clear {
        kept.push(HistoryRecord::Event(HistoryEvent::Clear { before }));
    }
    let mut seen_deletes = HashSet::new();
    let mut seen_results = HashSet::new();
    for record in own {
        match record {
            HistoryRecord::Event(HistoryEvent::Delete { id })
                if existing.contains(id.as_str()) && seen_deletes.insert(id.as_str()) =>
            {
                kept.push(record.clone());
            }
            HistoryRecord::Event(HistoryEvent::Result { id, at, .. })
                if existing.contains(id.as_str())
                    && latest_results.get(id.as_str()) == Some(at)
                    && seen_results.insert(id.as_str()) =>
            {
                kept.push(record.clone());
            }
            _ => {}
        }
    }
    // entries oldest first, as they were appended
    kept.extend(items.into_iter().rev().map(HistoryRecord::Item));
    kept
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::EditorHistoryKind;
    use crate::services::storage::test_support::{history_item, history_texts};

    fn item(id: &str, text: &str, created_at_ms: u64) -> EditorHistoryItem {
        let mut item = history_item(id, text, EditorHistoryKind::Source);
        item.created_at_ms = created_at_ms;
        item
    }

    fn entry(id: &str, text: &str, created_at_ms: u64) -> HistoryRecord {
        HistoryRecord::Item(item(id, text, created_at_ms))
    }

    fn event(event: HistoryEvent) -> HistoryRecord {
        HistoryRecord::Event(event)
    }

    #[test]
    fn records_read_back_as_they_were_written() {
        let lines = [
            r#"{"id":"a","text":"t","kind":"source","createdAt":1}"#,
            r#"{"type":"delete","id":"a"}"#,
            r#"{"type":"result","id":"a","result":"R","at":2}"#,
            r#"{"type":"clear","before":3}"#,
        ];
        let records: Vec<HistoryRecord> = lines
            .iter()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(records[0], entry("a", "t", 1));
        assert_eq!(records[1], event(HistoryEvent::Delete { id: "a".into() }));
        for (record, line) in records.iter().zip(lines) {
            assert_eq!(serde_json::to_string(record).unwrap(), line);
        }
    }

    #[test]
    fn the_journals_of_all_devices_merge_by_time_without_duplicates() {
        let laptop = vec![entry("a", "first", 1), entry("c", "third", 3)];
        let desktop = vec![entry("b", "second", 2), entry("a", "first", 1)];
        let merged = merge_journals(&[laptop, desktop]);
        assert_eq!(history_texts(&merged), ["third", "second", "first"]);
    }

    #[test]
    fn a_copy_moved_to_the_top_replaces_the_older_one() {
        let other = vec![entry("a", "text", 1), entry("b", "later", 2)];
        let own = vec![entry("a", "text", 5)];
        let merged = merge_journals(&[other, own]);
        assert_eq!(history_texts(&merged), ["text", "later"]);
        assert_eq!(merged[0].created_at_ms, 5);
    }

    #[test]
    fn events_of_one_device_change_the_entries_of_another() {
        let other = vec![entry("a", "one", 1), entry("b", "two", 2)];
        let own = vec![
            event(HistoryEvent::Delete { id: "b".into() }),
            event(HistoryEvent::Result {
                id: "a".into(),
                result: Some("One.".into()),
                at: 3,
            }),
        ];
        let merged = merge_journals(&[other.clone(), own.clone()]);
        assert_eq!(history_texts(&merged), ["one"]);
        assert_eq!(merged[0].result.as_deref(), Some("One."));
        // the latest result wins, wherever it is
        let later = vec![event(HistoryEvent::Result {
            id: "a".into(),
            result: None,
            at: 4,
        })];
        let merged = merge_journals(&[other, later, own]);
        assert_eq!(merged[0].result, None);
    }

    #[test]
    fn the_latest_clear_of_any_device_hides_what_came_before() {
        let other = vec![entry("a", "old", 1), entry("b", "new", 10)];
        let own = vec![
            event(HistoryEvent::Clear { before: 2 }),
            event(HistoryEvent::Clear { before: 5 }),
        ];
        assert_eq!(history_texts(&merge_journals(&[other, own])), ["new"]);
    }

    #[test]
    fn changes_name_only_what_changed() {
        let before = vec![item("b", "two", 2), item("a", "one", 1)];
        let mut moved = item("a", "one", 3);
        moved.is_result_applied = true;
        let mut with_result = item("b", "two", 2);
        with_result.result = Some("Two.".into());
        let after = vec![moved.clone(), with_result, item("c", "new", 4)];
        assert_eq!(
            changes(&before, &after, 10),
            [
                HistoryRecord::Item(item("c", "new", 4)),
                event(HistoryEvent::Result {
                    id: "b".into(),
                    result: Some("Two.".into()),
                    at: 10
                }),
                HistoryRecord::Item(moved),
            ]
        );
        assert_eq!(
            changes(&before, &before[..1], 10),
            [event(HistoryEvent::Delete { id: "a".into() })]
        );
    }

    #[test]
    fn compacting_keeps_the_events_of_entries_that_still_exist() {
        let others = vec![vec![entry("x", "other", 5)]];
        let own = vec![
            event(HistoryEvent::Delete { id: "x".into() }),
            event(HistoryEvent::Delete { id: "gone".into() }),
            event(HistoryEvent::Result {
                id: "x".into(),
                result: Some("old".into()),
                at: 6,
            }),
            event(HistoryEvent::Result {
                id: "x".into(),
                result: Some("new".into()),
                at: 7,
            }),
            event(HistoryEvent::Clear { before: 1 }),
            event(HistoryEvent::Clear { before: 2 }),
            entry("a", "expired", 3),
            entry("b", "kept", 8),
            entry("c", "newest", 9),
        ];
        let kept = compact(&own, &others, 4, 1, |_| {});
        assert_eq!(
            kept,
            [
                event(HistoryEvent::Clear { before: 2 }),
                event(HistoryEvent::Delete { id: "x".into() }),
                event(HistoryEvent::Result {
                    id: "x".into(),
                    result: Some("new".into()),
                    at: 7
                }),
                entry("c", "newest", 9),
            ]
        );
        // compacting again changes nothing
        assert_eq!(compact(&kept, &others, 4, 1, |_| {}), kept);
    }

    #[test]
    fn compacting_drops_the_events_of_entries_that_left_every_journal() {
        let own = vec![
            event(HistoryEvent::Delete { id: "x".into() }),
            entry("a", "kept", 3),
        ];
        assert_eq!(compact(&own, &[], 0, 10, |_| {}), [entry("a", "kept", 3)]);
    }
}
