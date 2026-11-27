//! The chats and dialogs of the memory-only histories ("While TyCo is
//! running"): kept in the memory of the process and gone when it ends,
//! however it ends. The stored ones stay on disk as they are and are shown
//! along with them; a session copy of a stored one hides it.
use std::collections::{HashMap, HashSet};

use crate::models::{Chat, ChatSummary, Dialog, DialogSummary};
use crate::services::chat_images::ChatFileIds;

/// The chats kept in memory, by the key of their scope.
#[derive(Default)]
pub struct SessionChats {
    chats: HashMap<String, Vec<Chat>>,
}

impl SessionChats {
    pub fn list(&self, scope: &str) -> &[Chat] {
        self.chats.get(scope).map_or(&[], Vec::as_slice)
    }

    pub fn get(&self, scope: &str, id: &str) -> Option<&Chat> {
        self.list(scope).iter().find(|chat| chat.id == id)
    }

    /// Stores `chat`, replacing the one of the same id.
    pub fn save(&mut self, scope: &str, mut chat: Chat) {
        chat.title = super::chat_history::clamp_chat_title(&chat.title);
        let chats = self.chats.entry(scope.to_string()).or_default();
        chats.retain(|known| known.id != chat.id);
        chats.push(chat);
    }

    /// Renames the chat; false when it is not kept here.
    pub fn rename(&mut self, scope: &str, id: &str, title: String) -> bool {
        let chat = self
            .chats
            .get_mut(scope)
            .and_then(|chats| chats.iter_mut().find(|chat| chat.id == id));
        match chat {
            Some(chat) => {
                chat.title = title;
                true
            }
            None => false,
        }
    }

    pub fn remove(&mut self, scope: &str, id: &str) -> Option<Chat> {
        let chats = self.chats.get_mut(scope)?;
        let index = chats.iter().position(|chat| chat.id == id)?;
        Some(chats.remove(index))
    }

    /// Takes every chat of the scope, e.g. to clear them or to store them on
    /// disk once the history is.
    pub fn take(&mut self, scope: &str) -> Vec<Chat> {
        self.chats.remove(scope).unwrap_or_default()
    }

    pub fn scopes(&self) -> Vec<String> {
        self.chats.keys().cloned().collect()
    }

    /// The images and attachment originals the chats refer to: the image
    /// store must keep them, as no file holds them.
    pub fn file_ids(&self) -> Vec<String> {
        let mut ids = ChatFileIds::default();
        for chat in self.chats.values().flatten() {
            ids.add(chat);
        }
        ids.images.into_iter().chain(ids.files).collect()
    }
}

/// The stored summaries with those of the session, which hide a stored one of
/// the same id, the most recent first.
pub fn merge_chat_summaries(stored: Vec<ChatSummary>, session: &[Chat]) -> Vec<ChatSummary> {
    let ids: HashSet<&str> = session.iter().map(|chat| chat.id.as_str()).collect();
    let mut merged: Vec<ChatSummary> = session.iter().map(ChatSummary::from).collect();
    merged.extend(
        stored
            .into_iter()
            .filter(|item| !ids.contains(item.id.as_str())),
    );
    merged.sort_by(|a, b| {
        b.last_message_at_ms
            .cmp(&a.last_message_at_ms)
            .then_with(|| a.id.cmp(&b.id))
    });
    merged
}

/// The ids of the session chats whose text holds `query`, lowercase.
pub fn search_session_chats(session: &[Chat], query: &str) -> HashSet<String> {
    session
        .iter()
        .filter(|chat| super::chat_history::chat_search_text(chat).contains(query))
        .map(|chat| chat.id.clone())
        .collect()
}

/// The latest questions of the session quick requests, newest first, at most
/// `limit`.
pub fn recent_session_prompts(session: &[Chat], limit: usize) -> Vec<String> {
    let mut quick: Vec<&Chat> = session
        .iter()
        .filter(|chat| chat.is_quick_request == Some(true))
        .collect();
    quick.sort_by_key(|chat| std::cmp::Reverse(chat.last_message_at_ms));
    let mut prompts = Vec::new();
    for chat in quick {
        for prompt in crate::models::recent_prompts_of(chat) {
            if prompts.len() >= limit {
                return prompts;
            }
            if !prompts.contains(&prompt) {
                prompts.push(prompt);
            }
        }
    }
    prompts
}

/// The dialogs kept in memory.
#[derive(Default)]
pub struct SessionDialogs {
    dialogs: Vec<Dialog>,
}

impl SessionDialogs {
    pub fn list(&self) -> &[Dialog] {
        &self.dialogs
    }

    pub fn get(&self, id: &str) -> Option<&Dialog> {
        self.dialogs.iter().find(|dialog| dialog.id == id)
    }

    /// Stores `dialog`, replacing the one of the same id. A session dialog
    /// has no recordings: nothing is recorded while the history is not on
    /// disk.
    pub fn save(&mut self, mut dialog: Dialog) {
        dialog.title = super::dialog_history::clamp_dialog_title(&dialog.title);
        self.dialogs.retain(|known| known.id != dialog.id);
        self.dialogs.push(dialog);
    }

    pub fn rename(&mut self, id: &str, title: String) -> bool {
        match self.dialogs.iter_mut().find(|dialog| dialog.id == id) {
            Some(dialog) => {
                dialog.title = title;
                true
            }
            None => false,
        }
    }

    pub fn remove(&mut self, id: &str) -> Option<Dialog> {
        let index = self.dialogs.iter().position(|dialog| dialog.id == id)?;
        Some(self.dialogs.remove(index))
    }

    pub fn take(&mut self) -> Vec<Dialog> {
        std::mem::take(&mut self.dialogs)
    }
}

/// The stored summaries with those of the session, the latest first.
pub fn merge_dialog_summaries(
    stored: Vec<DialogSummary>,
    session: &[Dialog],
) -> Vec<DialogSummary> {
    let ids: HashSet<&str> = session.iter().map(|dialog| dialog.id.as_str()).collect();
    let mut merged: Vec<DialogSummary> = session.iter().map(DialogSummary::from).collect();
    merged.extend(
        stored
            .into_iter()
            .filter(|item| !ids.contains(item.id.as_str())),
    );
    merged.sort_by(|a, b| {
        b.started_at_ms
            .cmp(&a.started_at_ms)
            .then_with(|| a.id.cmp(&b.id))
    });
    merged
}

pub fn search_session_dialogs(session: &[Dialog], query: &str) -> HashSet<String> {
    session
        .iter()
        .filter(|dialog| super::dialog_history::dialog_search_text(dialog).contains(query))
        .map(|dialog| dialog.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chat(id: &str, at: u64) -> Chat {
        let mut chat: Chat = serde_json::from_value(serde_json::json!({
            "id": id, "title": id, "lastMessageAt": at, "messages": []
        }))
        .unwrap();
        chat.last_message_at_ms = at;
        chat
    }

    fn summary(id: &str, at: u64) -> ChatSummary {
        ChatSummary::from(&chat(id, at))
    }

    #[test]
    fn session_chats_hide_stored_ones_and_sort_with_them() {
        let mut session = SessionChats::default();
        session.save("askAi", chat("b", 5));
        session.save("askAi", chat("c", 1));
        let merged = merge_chat_summaries(
            vec![summary("a", 3), summary("b", 2)],
            session.list("askAi"),
        );
        let ids: Vec<_> = merged.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["b", "a", "c"]);
        assert!(session.list("other").is_empty());
    }

    #[test]
    fn session_chats_are_saved_renamed_removed_and_taken() {
        let mut session = SessionChats::default();
        session.save("askAi", chat("a", 1));
        session.save("askAi", chat("a", 2));
        assert_eq!(session.list("askAi").len(), 1);
        assert!(session.rename("askAi", "a", "Trip".into()));
        assert!(!session.rename("askAi", "x", "Trip".into()));
        assert_eq!(session.get("askAi", "a").unwrap().title, "Trip");
        assert!(search_session_chats(session.list("askAi"), "trip").contains("a"));
        assert!(session.remove("askAi", "a").is_some());
        session.save("askAi", chat("b", 1));
        assert_eq!(session.take("askAi").len(), 1);
        assert!(session.scopes().is_empty());
    }
}
