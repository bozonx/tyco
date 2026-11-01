//! Telling a copied selection from the current line an editor copies when
//! nothing is selected: VS Code, Visual Studio, Scintilla editors and others
//! copy the whole line on the copy keys. Pasting a result over "the
//! selection" would then insert the line at the cursor a second time.
//!
//! Some editors mark such a copy in the clipboard; on Linux the primary
//! selection also tells what is really selected.

/// Clipboard formats Visual Studio and Scintilla editors (Notepad++) add to a
/// copy of the current line.
pub(crate) const LINE_COPY_FORMATS: [&str; 2] = [
    "MSDEVLineSelect",
    "VisualStudioEditorOperationsLineCutCopyClipboardTag",
];

/// Where Chromium keeps the custom types a page puts into the clipboard,
/// e.g. the `vscode-editor-data` of VS Code and other Monaco editors.
#[cfg(target_os = "linux")]
pub(crate) const CHROMIUM_CUSTOM_DATA_TYPE: &str = "chromium/x-web-custom-data";
#[cfg(target_os = "windows")]
pub(crate) const CHROMIUM_CUSTOM_DATA_TYPE: &str = "Chromium Web Custom MIME Data Format";

/// The custom type of Monaco editors, when a toolkit offers it as it is.
#[cfg(target_os = "linux")]
pub(crate) const MONACO_DATA_TYPE: &str = "vscode-editor-data";

/// How Monaco marks the copy of a line made without a selection.
const MONACO_EMPTY_SELECTION: &str = r#""isFromEmptySelection":true"#;

/// Whether clipboard data of Monaco, as it is or inside Chromium's custom
/// data (UTF-16 strings), marks a copy made without a selection.
pub(crate) fn is_empty_selection_data(data: &[u8]) -> bool {
    if String::from_utf8_lossy(data).contains(MONACO_EMPTY_SELECTION) {
        return true;
    }
    // the strings of the pickle are UTF-16; try both byte alignments
    [0, 1].into_iter().any(|offset| {
        let units: Vec<u16> = data
            .get(offset..)
            .unwrap_or_default()
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .collect();
        String::from_utf16_lossy(&units).contains(MONACO_EMPTY_SELECTION)
    })
}

/// Line breaks as one character and no whitespace at the ends: copies and
/// selections of the same text differ in those across applications.
pub(crate) fn normalized(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\u{a0}', " ")
        .trim()
        .to_owned()
}

/// Whether the primary selection, made in the copied window, shows that the
/// copy keys copied something other than the selection.
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub(crate) fn contradicts_primary(copied: &str, primary: Option<&str>) -> bool {
    primary
        .map(normalized)
        .is_some_and(|primary| !primary.is_empty() && primary != normalized(copied))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONACO: &str =
        r#"{"version":1,"isFromEmptySelection":true,"multicursorText":null,"mode":"rust"}"#;

    #[test]
    fn tells_a_monaco_line_copy_as_it_is_and_inside_chromium_custom_data() {
        assert!(is_empty_selection_data(MONACO.as_bytes()));
        for offset in [0usize, 1] {
            let mut pickle = vec![0u8; 8 + offset];
            pickle.extend(MONACO.encode_utf16().flat_map(u16::to_le_bytes));
            assert!(is_empty_selection_data(&pickle));
        }
        let selection = MONACO.replace("true", "false");
        assert!(!is_empty_selection_data(selection.as_bytes()));
        let pickle: Vec<u8> = selection
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert!(!is_empty_selection_data(&pickle));
    }

    #[test]
    fn a_copy_other_than_the_primary_selection_is_no_selection() {
        assert!(contradicts_primary("fn main() {}\n", Some("main")));
        assert!(!contradicts_primary(
            "line one\r\nline two\r\n",
            Some("line one\nline two")
        ));
        assert!(!contradicts_primary("a\u{a0}b", Some("a b")));
        // nothing known about the selection
        assert!(!contradicts_primary("text", None));
        assert!(!contradicts_primary("text", Some("  ")));
    }
}
