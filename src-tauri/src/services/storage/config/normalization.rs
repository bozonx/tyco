//! Rules the shared config schema cannot express. Field types, enums and
//! defaults are repaired by `schema::normalize_user_config`, which runs
//! after these.

mod hotkeys;
pub(super) use hotkeys::normalize_hotkeys_config;

mod language;
pub(super) use language::normalize_language_config;

mod window_insertion;
pub(super) use window_insertion::normalize_window_insertion_config;

#[cfg(test)]
mod tests;
