# Conversation files

Who owns the files of a conversation, where they live and when they go, shared
by images and attachment originals. How the webview holds images is described
in `src-tauri/src/commands/chat_images.rs`.

## Entities

- **Conversation environment**: `general` ("Ask AI", no profile) or
  `profile(<id>)`. It decides the chat folder, the history policy and what the
  tools reach. Code that only needs to tell them apart keeps using
  `profileId: string | null`; the environment is explicit at the storage and
  tool boundaries (`ChatScope` in Rust).
- **Conversation files**: what the user attached to messages of one
  conversation: normalized images (`ChatMessage.images`) and the originals of
  attached documents (`ChatAttachment.file`). They follow the history of the
  conversation.
- **Profile materials**: `workspace/`, projects and `memory/` of a profile. They
  are permanent and never touched by chat history cleanup.

## Paths

```
user-data/chats/                      general conversations
├── <chat-id>.json
├── images/<sha256>.webp
└── attachments/<sha256>

ai-vault/profiles/<profile-id>/
├── chats/                            same layout as above
├── workspace/                        permanent materials
└── memory/
```

Conversation files are content-addressed: the name is the SHA-256 of the
bytes, the chat JSON keeps only references (`{ id, size }` plus the name and
media type of the attachment). Each history has its own folder, so files move
with the AI vault, and clearing the general history cannot reach a profile.
Orphan records stay in `index/orphan-images.json` of the state folder, keyed by
the folder of each history.

## Ownership and lifetime

One session store in Rust (`services/chat_images.rs`) holds image and file
bytes under owners: imports, the chats shown by windows, the undo of a
deletion. The webview syncs the ids its conversation shows, images and files
alike (`sync_chat_images`).

| Event              | What happens                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Attach             | The original goes to session memory under an import owner, whatever the tools of the profile allow (`store_chat_file`).              |
| Draft, history off | Bytes stay in memory only, while a window holds them.                                                                                |
| Save               | Referenced files are written once to the folder of the history.                                                                      |
| Branch             | The branch copies references; the bytes are shared.                                                                                  |
| Delete chat        | The JSON goes, and so do the files no other chat of its history refers to. Undo holds the bytes in memory and writes them back.      |
| Edit               | A saved version that no longer refers to a file removes it, unless another chat of the history does.                                 |
| Retention, clear   | Expired chats go with their files, as on deletion; `clear` removes the whole history folder, images and attachments included.        |
| Orphan collection  | A safety net for files no deletion accounted for: removed after seven days without a reference (a sync tool may bring a file early). |
| Save to workspace  | A copy goes to `workspace/` of the profile and is permanent from then on (`save_chat_file_to_workspace`).                            |
| Export             | The user saves a copy wherever they choose.                                                                                          |

## Tools

The file tools get their roots from the conversation, resolved in Rust
(`ConversationFiles`). The webview names ids and model paths, never absolute
paths.

- general: `attachments/` of the conversation, read-only;
- profile: `attachments/`, plus `workspace/` and the permitted projects when
  the profile's file tools are on;
- memory stays a separate capability of a profile.

`attachments/<name>` names an attachment by its file name; equal names get
` (2)`, ` (3)` in the order they were attached. The webview sends the list of
`{ name, id }` of its conversation, Rust validates the names and reads the
bytes from the session store or the history folder of that environment.

## Quick request

The quick request owns one conversation session: its chat id, files and tool
permissions. Opening it in the full chat hands over the same chat id with its
messages and file references.

A quick request is a chat with another face: `quick-ai-request-model.ts` runs
its turns on the parts of the main chat (`createChatState`,
`createChatGenerationModel`, `createChatPersistenceQueue`,
`createChatTitleController`), so the context budget, errors, stopping, saving
and titles behave the same; only the feed of turns with reply blocks is its
own, a view of the chat messages. It is stored with `isQuickRequest` once
answered, unless `isQuickRequestSavingEnabled` of its scope is off; with it off,
the recent questions of stored quick requests are not offered either; a question
that got no answer is not stored and gives way to the next one. Moving it to
the main chat goes through `open_transferred_chat` for text and screenshots
alike: the main chat starts it with the same id and saves it without the flag,
as an ordinary chat. The answers inserted or copied from it are kept in the
editor history with the `quickAiRequest` origin.
