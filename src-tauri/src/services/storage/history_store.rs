//! Storage owns synchronization; IPC callers never take history locks.
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager};

use super::{chat_history as chats, editor_history as editor};
use crate::errors::AppError;
use crate::models::{Chat, ChatSummary, CreateEditorHistoryRequest, EditorHistoryRecord};
use crate::state::AppState;

#[derive(Default)]
pub struct HistoryStorage {
    editor_history: Mutex<Vec<EditorHistoryRecord>>,
    chat_history_lock: Mutex<()>,
}

impl HistoryStorage {
    fn lock_editor_history(&self) -> MutexGuard<'_, Vec<EditorHistoryRecord>> {
        self.editor_history
            .lock()
            .expect("editor history lock poisoned")
    }

    fn lock_chat_history(&self) -> MutexGuard<'_, ()> {
        self.chat_history_lock
            .lock()
            .expect("chat history lock poisoned")
    }

    /// Settings and their in-memory publication share the same lock order as
    /// all history operations: editor history, chat history, then the desktop
    /// snapshot. Both repositories observe the new policy only after its
    /// storage transition finishes.
    pub fn apply_settings(
        &self,
        app: &AppHandle,
        previous: &serde_json::Value,
        next: &serde_json::Value,
    ) -> Result<(), AppError> {
        let mut memory = self.lock_editor_history();
        let _chats = self.lock_chat_history();
        editor::apply_history_settings_change(app, previous, next, &mut memory)?;
        app.state::<AppState>()
            .update_snapshot(|snapshot| snapshot.settings.user_config = next.clone());
        Ok(())
    }
}

fn with_editor<T>(
    app: &AppHandle,
    operation: impl FnOnce(&serde_json::Value, &mut Vec<EditorHistoryRecord>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let mut memory = state.history.lock_editor_history();
    operation(&state.snapshot().settings.user_config, &mut memory)
}

fn with_chats<T>(
    app: &AppHandle,
    operation: impl FnOnce(&AppState) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let _guard = state.history.lock_chat_history();
    operation(&state)
}

pub fn get_editor_history(app: &AppHandle) -> Result<Vec<EditorHistoryRecord>, AppError> {
    with_editor(app, |config, memory| {
        editor::get_editor_history(app, config, memory)
    })
}

pub fn save_editor_history(
    app: &AppHandle,
    entry: CreateEditorHistoryRequest,
) -> Result<Option<String>, AppError> {
    with_editor(app, |config, memory| {
        editor::save_editor_history(app, config, memory, entry)
    })
}

pub fn set_editor_history_result(
    app: &AppHandle,
    id: String,
    result: String,
) -> Result<(), AppError> {
    with_editor(app, |config, memory| {
        editor::set_editor_history_result(app, config, memory, id, result)
    })
}

pub fn restore_editor_history_item(
    app: &AppHandle,
    item: EditorHistoryRecord,
) -> Result<(), AppError> {
    with_editor(app, |config, memory| {
        editor::restore_editor_history_item(app, config, memory, item)
    })
}

pub fn remove_from_editor_history(app: &AppHandle, id: String) -> Result<(), AppError> {
    with_editor(app, |config, memory| {
        editor::remove_from_editor_history(app, config, memory, id)
    })
}

pub fn clear_editor_history(app: &AppHandle) -> Result<(), AppError> {
    with_editor(app, |_, memory| editor::clear_editor_history(app, memory))
}

pub fn list_chats(app: &AppHandle) -> Result<Vec<ChatSummary>, AppError> {
    with_chats(app, |_| chats::list_chats(app))
}

/// Import leases and image loading are protected against concurrent cleanup.
pub fn get_chat(
    app: &AppHandle,
    id: String,
    owner: Option<String>,
) -> Result<Option<Chat>, AppError> {
    with_chats(app, |state| {
        chats::recover_chat_transaction(&super::app_data_sub_dir(app, "chats")?)?;
        let chat = chats::get_chat(app, id)?;
        if let Some(chat) = &chat {
            load_chat_images(app, state, chat, ImageRetention::Active(owner.as_deref()))?;
        }
        Ok(chat)
    })
}

pub fn save_chat(app: &AppHandle, item: Chat) -> Result<(), AppError> {
    with_chats(app, |state| {
        chats::save_chat(app, &state.snapshot().settings.user_config, item)
    })
}

pub fn rename_chat(app: &AppHandle, id: String, title: String) -> Result<(), AppError> {
    with_chats(app, |_| chats::rename_chat(app, id, title))
}

pub fn search_chats(app: &AppHandle, query: String) -> Result<Vec<String>, AppError> {
    // The index is a snapshot. Atomic file replacements allow searching each
    // chat without holding up unrelated saves or editor history operations.
    let history = list_chats(app)?;
    chats::search_chats(app, history, query)
}

pub fn delete_chat(app: &AppHandle, id: String, owner: String) -> Result<(), AppError> {
    with_chats(app, |state| {
        chats::recover_chat_transaction(&super::app_data_sub_dir(app, "chats")?)?;
        match chats::get_chat(app, id.clone()) {
            Ok(Some(chat)) => {
                load_chat_images(app, state, &chat, ImageRetention::Undo(&owner))?;
            }
            Ok(None) => {}
            Err(error) => log::warn!("Removing chat {id}, which cannot be read: {error}"),
        }
        chats::delete_chat(app, id)
    })
}

pub fn clear_chats(app: &AppHandle) -> Result<(), AppError> {
    with_chats(app, |_| chats::clear_chats(app))
}

enum ImageRetention<'a> {
    Active(Option<&'a str>),
    Undo(&'a str),
}

fn load_chat_images(
    app: &AppHandle,
    state: &AppState,
    chat: &Chat,
    retention: ImageRetention<'_>,
) -> Result<(), AppError> {
    let directory = chats::chat_image_directory(app)?;
    let mut images = state.chat_images.lock().expect("chat image lock poisoned");
    for image in chat.messages.iter().flat_map(|message| &message.images) {
        match retention {
            ImageRetention::Active(Some(owner)) => images.hold(owner, &image.id),
            ImageRetention::Active(None) => {}
            ImageRetention::Undo(owner) => images.hold_undo(owner, &image.id),
        }
        let result = images.get(&directory, &image.id);
        if let ImageRetention::Undo(_) = retention {
            if let Err(error) = result {
                log::warn!("Could not preserve chat image for undo: {error}");
            }
        }
    }
    Ok(())
}

pub fn get_chat_image(app: &AppHandle, id: &str) -> Result<Vec<u8>, AppError> {
    with_chats(app, |state| {
        state
            .chat_images
            .lock()
            .expect("chat image lock poisoned")
            .get(&chats::chat_image_directory(app)?, id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_operations_do_not_lock_editor_history() {
        let storage = HistoryStorage::default();
        let _chats = storage.lock_chat_history();
        assert!(storage.editor_history.try_lock().is_ok());
    }

    #[test]
    fn editor_operations_do_not_lock_chat_history() {
        let storage = HistoryStorage::default();
        let _editor = storage.lock_editor_history();
        assert!(storage.chat_history_lock.try_lock().is_ok());
    }

    #[test]
    fn concurrent_editor_updates_are_serialized() {
        let storage = HistoryStorage::default();
        std::thread::scope(|scope| {
            for index in 0..16 {
                let storage = &storage;
                scope.spawn(move || {
                    storage.lock_editor_history().push(EditorHistoryRecord {
                        id: index.to_string(),
                        text: String::new(),
                        kind: crate::models::EditorHistoryKind::Draft,
                        operation: None,
                        created_at_ms: 1,
                        result: None,
                        is_result_applied: false,
                    });
                });
            }
        });
        assert_eq!(storage.lock_editor_history().len(), 16);
    }
}
