//! The IPC commands of the webview, one module per domain. They validate the
//! call and hand it to `services`.
pub mod action_logs;
pub mod activation;
pub mod ai_files;
pub mod ai_vault;
pub mod chat_images;
pub mod chats;
pub mod desktop_state;
pub mod diagnostics;
pub mod editor_history;
pub mod external_jobs;
pub mod hotkeys;
pub mod net;
pub mod plugins;
pub mod script_actions;
pub mod secrets;
pub mod selection;
pub mod settings;
pub mod storage;
pub mod system;
pub mod voice;
pub mod window;

pub use crate::services::background::run_blocking;
