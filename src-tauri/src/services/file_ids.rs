//! Ids that become file or folder names, such as those of chats and AI
//! profiles: letters, digits, `-` and `_` only, so that none can leave its
//! directory or clash with a name the platform reserves for paths.

pub const MAX_FILE_ID_LEN: usize = 64;

pub fn is_file_id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

pub fn is_file_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_FILE_ID_LEN && id.chars().all(is_file_id_char)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_ids_stay_inside_their_directory() {
        assert!(is_file_id("2b9c0f4e-7d1a-4c3e-9f55-0a1b2c3d4e5f"));
        assert!(is_file_id("writer_1"));
        for id in ["", ".", "..", "../x", "a/b", "a\\b", "a:b", "a b"] {
            assert!(!is_file_id(id), "{id:?}");
        }
        assert!(is_file_id(&"a".repeat(MAX_FILE_ID_LEN)));
        assert!(!is_file_id(&"a".repeat(MAX_FILE_ID_LEN + 1)));
    }
}
