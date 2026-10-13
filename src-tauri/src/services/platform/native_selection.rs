//! Selection text is JSON encoded by native readers to preserve whitespace.

pub(super) fn decode_selected_text(output: &[u8]) -> Option<String> {
    let text: String = serde_json::from_slice(output).ok()?;
    (!text.trim().is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_unicode_and_selection_whitespace() {
        let text = "  naïve\n\"quoted\"\t\n";
        let output = serde_json::to_vec(text).unwrap();
        assert_eq!(decode_selected_text(&output), Some(text.into()));
    }

    #[test]
    fn rejects_missing_empty_or_invalid_selection_output() {
        for output in [b"null".as_slice(), b"\" \"", b"\"\"", b"error", b"42"] {
            assert_eq!(decode_selected_text(output), None);
        }
    }
}
