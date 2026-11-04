//! Pure ordering, deduplication, result updates, and restoration of entries.
use crate::models::{EditorHistoryItem, EditorHistoryKind};

/// How much an entry says about the text: a text that was sent somewhere or
/// fed to the AI must not turn into a plain draft just because it is still in
/// the editor
fn kind_rank(kind: EditorHistoryKind) -> u8 {
    match kind {
        EditorHistoryKind::Draft => 0,
        EditorHistoryKind::Source => 1,
        EditorHistoryKind::Output => 2,
    }
}

fn collapses_duplicate(new_kind: EditorHistoryKind, existing_kind: EditorHistoryKind) -> bool {
    match (new_kind, existing_kind) {
        // A source supersedes an incidental draft, but every AI operation and
        // every actual output remains a separate event.
        (EditorHistoryKind::Source, EditorHistoryKind::Draft) => true,
        (EditorHistoryKind::Source, _) | (_, EditorHistoryKind::Source) => false,
        _ => true,
    }
}

/// Puts `item` on top and returns the id of the entry that now holds the text.
/// Draft snapshots are collapsed, and repeated outputs are moved to the top.
/// Sources stay separate because the same text may be used by several AI
/// operations and every result must remain attached to its source. A draft or
/// an output of an AI result is not a new entry: its source is moved to the top
/// instead, marked as sent in the case of an output.
pub(super) fn push_editor_history(
    history: &mut Vec<EditorHistoryItem>,
    mut item: EditorHistoryItem,
    limit: usize,
) -> String {
    let text = item.text.trim();

    if item.kind != EditorHistoryKind::Source {
        if let Some(index) = history.iter().position(|existing| {
            existing.kind == EditorHistoryKind::Source
                && (existing.result.as_deref().map(str::trim) == Some(text)
                    || (item.kind == EditorHistoryKind::Output
                        && existing.result.is_none()
                        && existing.text.trim() == text))
        }) {
            let mut source = history.remove(index);
            source.is_result_applied |= item.kind == EditorHistoryKind::Output;
            source.origin = source.origin.or(item.origin);
            source.instruction = source.instruction.or(item.instruction);
            source.created_at_ms = item.created_at_ms;
            history.retain(|existing| {
                existing.kind == EditorHistoryKind::Source || existing.text.trim() != text
            });

            let id = source.id.clone();
            history.insert(0, source);
            history.truncate(limit);
            return id;
        }
    }

    let duplicates: Vec<EditorHistoryItem> = history
        .iter()
        .filter(|existing| {
            existing.text.trim() == text && collapses_duplicate(item.kind, existing.kind)
        })
        .cloned()
        .collect();

    history.retain(|existing| {
        existing.text.trim() != text || !collapses_duplicate(item.kind, existing.kind)
    });

    if let Some(stronger) = duplicates
        .iter()
        .filter(|existing| kind_rank(existing.kind) > kind_rank(item.kind))
        .max_by_key(|existing| kind_rank(existing.kind))
    {
        item.kind = stronger.kind;
        item.operation = stronger.operation;
    }

    // what the AI made of the text stays comparable whatever happens to it next
    if item.result.is_none() {
        item.result = duplicates
            .iter()
            .find_map(|existing| existing.result.clone());
    }
    // a draft collapsed into its output still tells where it was typed
    if item.origin.is_none() {
        item.origin = duplicates.iter().find_map(|existing| existing.origin);
    }
    if item.instruction.is_none() {
        item.instruction = duplicates
            .iter()
            .find_map(|existing| existing.instruction.clone());
    }

    let id = item.id.clone();
    history.insert(0, item);
    history.truncate(limit);
    id
}

pub(super) fn apply_editor_history_result(
    history: &mut [EditorHistoryItem],
    id: &str,
    result: String,
) -> bool {
    let Some(item) = history.iter_mut().find(|item| item.id == id) else {
        return false;
    };

    item.result = (!result.trim().is_empty()).then_some(result);
    true
}

/// Entries are ordered newest first, so the item goes before the first older
/// one. Nothing is inserted when the item is there already, or when the same
/// text has been added again meanwhile as an entry that would have absorbed
/// it, see `collapses_duplicate`: sources with the same text stay separate.
pub(super) fn insert_restored_item(
    history: &mut Vec<EditorHistoryItem>,
    item: EditorHistoryItem,
    limit: usize,
) -> bool {
    let text = item.text.trim();

    if history.iter().any(|existing| {
        existing.id == item.id
            || (existing.text.trim() == text && collapses_duplicate(existing.kind, item.kind))
    }) {
        return false;
    }

    let index = history
        .iter()
        .position(|existing| existing.created_at_ms < item.created_at_ms)
        .unwrap_or(history.len());

    if index >= limit {
        return false;
    }

    history.insert(index, item);
    history.truncate(limit);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EditorHistoryOperation, EditorHistoryOrigin};
    use crate::services::storage::test_support::{history_item, history_texts};

    #[test]
    fn push_editor_history_moves_a_duplicate_to_the_top() {
        let mut history = vec![
            history_item("b", "second", EditorHistoryKind::Draft),
            history_item("a", "first", EditorHistoryKind::Draft),
        ];

        push_editor_history(
            &mut history,
            history_item("c", "  first\n", EditorHistoryKind::Source),
            10,
        );

        assert_eq!(history_texts(&history), vec!["  first\n", "second"]);
        assert_eq!(history[0].id, "c");
        assert_eq!(history[0].kind, EditorHistoryKind::Source);
    }

    #[test]
    fn push_editor_history_keeps_the_origin_of_a_draft_collapsed_into_its_output() {
        let mut draft = history_item("a", "text", EditorHistoryKind::Draft);
        draft.origin = Some(EditorHistoryOrigin::QuickInput);
        let mut history = vec![draft];

        push_editor_history(
            &mut history,
            history_item("b", "text", EditorHistoryKind::Output),
            10,
        );

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].kind, EditorHistoryKind::Output);
        assert_eq!(history[0].origin, Some(EditorHistoryOrigin::QuickInput));
    }

    #[test]
    fn push_editor_history_keeps_the_origin_of_a_source_marked_as_sent() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        source.origin = Some(EditorHistoryOrigin::Voice);
        let mut history = vec![source];

        push_editor_history(
            &mut history,
            history_item("b", "Text.", EditorHistoryKind::Output),
            10,
        );

        assert_eq!(history.len(), 1);
        assert!(history[0].is_result_applied);
        assert_eq!(history[0].origin, Some(EditorHistoryOrigin::Voice));
    }

    #[test]
    fn push_editor_history_keeps_an_output_and_a_new_source_separate() {
        let mut history = vec![history_item("a", "sent", EditorHistoryKind::Output)];
        let mut source = history_item("b", "sent", EditorHistoryKind::Source);
        source.operation = Some(EditorHistoryOperation::Translation);

        push_editor_history(&mut history, source, 10);

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, "b");
        assert_eq!(history[0].kind, EditorHistoryKind::Source);
        assert_eq!(
            history[0].operation,
            Some(EditorHistoryOperation::Translation)
        );
        assert_eq!(history[1].kind, EditorHistoryKind::Output);
    }

    #[test]
    fn push_editor_history_keeps_repeated_ai_operations_separate() {
        let mut first = history_item("a", "text", EditorHistoryKind::Source);
        first.operation = Some(EditorHistoryOperation::Translation);
        first.result = Some(String::from("Translation"));
        let mut second = history_item("b", "text", EditorHistoryKind::Source);
        second.operation = Some(EditorHistoryOperation::Correction);
        let mut history = vec![first];

        push_editor_history(&mut history, second, 10);

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, "b");
        assert_eq!(history[0].result, None);
        assert_eq!(history[1].id, "a");
        assert_eq!(history[1].result.as_deref(), Some("Translation"));
    }

    #[test]
    fn push_editor_history_keeps_a_source_when_the_same_text_becomes_a_draft() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.operation = Some(EditorHistoryOperation::Correction);
        source.result = Some(String::from("Text."));
        let mut history = vec![source];

        push_editor_history(
            &mut history,
            history_item("b", "text", EditorHistoryKind::Draft),
            10,
        );

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].kind, EditorHistoryKind::Draft);
        assert_eq!(history[1].kind, EditorHistoryKind::Source);
        assert_eq!(
            history[1].operation,
            Some(EditorHistoryOperation::Correction)
        );
        assert_eq!(history[1].result.as_deref(), Some("Text."));
    }

    #[test]
    fn push_editor_history_keeps_the_ai_source_and_its_sent_output() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        let mut history = vec![source];

        push_editor_history(
            &mut history,
            history_item("b", "text", EditorHistoryKind::Output),
            10,
        );

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].kind, EditorHistoryKind::Output);
        assert_eq!(history[0].result, None);
        assert_eq!(history[1].kind, EditorHistoryKind::Source);
        assert_eq!(history[1].result.as_deref(), Some("Text."));
    }

    #[test]
    fn push_editor_history_marks_the_source_of_a_sent_ai_result() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        let mut history = vec![
            history_item("d", "Text.", EditorHistoryKind::Draft),
            history_item("o", "older", EditorHistoryKind::Output),
            source,
        ];
        let mut output = history_item("b", "Text.\n", EditorHistoryKind::Output);
        output.created_at_ms = 5;

        let id = push_editor_history(&mut history, output, 10);

        assert_eq!(id, "a");
        assert_eq!(history_texts(&history), vec!["text", "older"]);
        assert!(history[0].is_result_applied);
        assert_eq!(history[0].created_at_ms, 5);
        assert_eq!(history[0].kind, EditorHistoryKind::Source);
    }

    #[test]
    fn push_editor_history_keeps_an_ai_result_draft_in_its_source() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        let mut history = vec![
            history_item("o", "older", EditorHistoryKind::Output),
            source,
        ];

        let id = push_editor_history(
            &mut history,
            history_item("d", "Text.", EditorHistoryKind::Draft),
            10,
        );

        assert_eq!(id, "a");
        assert_eq!(history_texts(&history), vec!["text", "older"]);
        assert!(!history[0].is_result_applied);
    }

    #[test]
    fn push_editor_history_truncates_to_the_limit() {
        let mut history = vec![
            history_item("b", "second", EditorHistoryKind::Draft),
            history_item("a", "first", EditorHistoryKind::Draft),
        ];

        push_editor_history(
            &mut history,
            history_item("c", "third", EditorHistoryKind::Output),
            2,
        );

        assert_eq!(history_texts(&history), vec!["third", "second"]);
    }

    #[test]
    fn apply_editor_history_result_sets_and_clears_the_result() {
        let mut history = vec![history_item("a", "text", EditorHistoryKind::Source)];

        assert!(apply_editor_history_result(
            &mut history,
            "a",
            String::from("Text.")
        ));
        assert_eq!(history[0].result.as_deref(), Some("Text."));

        assert!(apply_editor_history_result(
            &mut history,
            "a",
            String::from("  ")
        ));
        assert_eq!(history[0].result, None);

        assert!(!apply_editor_history_result(
            &mut history,
            "missing",
            String::from("x")
        ));
    }

    #[test]
    fn insert_restored_item_goes_back_to_its_place() {
        let mut newer = history_item("n", "newer", EditorHistoryKind::Draft);
        newer.created_at_ms = 30;
        let mut older = history_item("o", "older", EditorHistoryKind::Draft);
        older.created_at_ms = 10;
        let mut history = vec![newer, older];
        let mut removed = history_item("r", "removed", EditorHistoryKind::Output);
        removed.created_at_ms = 20;

        assert!(insert_restored_item(&mut history, removed, 10));
        assert_eq!(history_texts(&history), vec!["newer", "removed", "older"]);
    }

    #[test]
    fn insert_restored_item_skips_a_text_added_again() {
        let mut history = vec![history_item("n", "same", EditorHistoryKind::Draft)];

        assert!(!insert_restored_item(
            &mut history,
            history_item("r", " same ", EditorHistoryKind::Output),
            10
        ));
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn insert_restored_item_brings_back_a_source_beside_another_with_the_same_text() {
        let mut kept = history_item("k", "text", EditorHistoryKind::Source);
        kept.created_at_ms = 30;
        let mut history = vec![kept];
        let mut removed = history_item("r", "text", EditorHistoryKind::Source);
        removed.created_at_ms = 20;
        removed.result = Some(String::from("Text."));

        assert!(insert_restored_item(&mut history, removed, 10));
        assert_eq!(history.len(), 2);
        assert_eq!(history[1].id, "r");
        assert_eq!(history[1].result.as_deref(), Some("Text."));
    }

    #[test]
    fn insert_restored_item_skips_an_item_that_is_there_already() {
        let mut history = vec![history_item("r", "text", EditorHistoryKind::Source)];

        assert!(!insert_restored_item(
            &mut history,
            history_item("r", "text", EditorHistoryKind::Source),
            10
        ));
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn insert_restored_item_respects_the_limit() {
        let mut newer = history_item("n", "newer", EditorHistoryKind::Draft);
        newer.created_at_ms = 30;
        let mut history = vec![newer];
        let mut removed = history_item("r", "removed", EditorHistoryKind::Draft);
        removed.created_at_ms = 10;

        assert!(!insert_restored_item(&mut history, removed, 1));
        assert_eq!(history_texts(&history), vec!["newer"]);
    }
}

#[cfg(test)]
mod input_completion_tests {
    use super::*;
    use crate::services::storage::test_support::history_item;

    #[test]
    fn output_without_ai_changes_marks_the_transcript_instead_of_duplicating_it() {
        let source = history_item("voice", "raw speech", EditorHistoryKind::Source);
        let mut items = vec![source];
        let id = push_editor_history(
            &mut items,
            history_item("sent", "raw speech", EditorHistoryKind::Output),
            100,
        );
        assert_eq!(id, "voice");
        assert_eq!(items.len(), 1);
        assert!(items[0].is_result_applied);
    }
}
