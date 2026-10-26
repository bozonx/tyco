# Desktop API

The Rust code is the source of truth for the native command surface. Run
`pnpm generate:desktop` after changing a command, an IPC type or an event:

- `src-tauri/src/bindings.rs` declares every IPC type with ts-rs into
  `packages/shared/src/generated/desktop-types.ts`, along with the error codes
  and the payload of every event of `src-tauri/src/events.rs`. `cargo test`
  fails while the file is stale.
- `scripts/generate-desktop-commands.mjs` reads the command signatures of
  `src-tauri/src/commands` into `packages/shared/src/generated/desktop-commands.ts`.
  A type without a binding fails the generation rather than becoming `any`.
  `pnpm check:architecture` rejects stale commands, missing registration and
  missing explicit permissions.

A type keeps its Rust name in TypeScript. `#[ts(rename)]` is for nested types
only, where the Rust module gives the context the TypeScript name must carry.

## Naming

Commands are `verb_noun`: `get_*` returns a DTO, `read_*`/`write_*` move file
contents or bytes, `save_*` stores a DTO, `delete_*` removes an entity, `list_*`
returns a collection, `open_*` shows something in the system.

## Errors

Every command fails with `DesktopErrorPayload { code, message }`. The code says
what the webview may decide on (`configConflict`, `fileTooLarge`, `stale`, ...),
the message is for people.

## Events

Each event of `src-tauri/src/events.rs` names its payload type; it is emitted
with `events::emit::<E>` or `events::emit_to::<E>`, so the payload cannot drift
from `DesktopEventPayloads`. `DESKTOP_EVENTS` of `@tyco/shared` must name every
event.

## Binary arguments

A command that takes bytes takes a `BinaryRequest<M>`: the bytes go as the raw
IPC body, the metadata `M` as percent-encoded JSON in the `x-tyco-meta` header.
In TypeScript the argument is `BinaryArgs<M>`; `invokeDesktop` splits it.

## Calling commands

- `apps/desktop-ui/src/lib/desktop/invoke.ts`: the native boundary; rejects with
  `DesktopIpcError`. Native adapters (network, microphone, images, file tools)
  call it directly.
- `apps/desktop-ui/src/lib/ipc/ipc-model.ts` (`useIpcStore`): `call` and
  `callOrNotify` resolve to an `IpcResult` instead. They add the `activationId`
  of the window to the commands that act for an activation and wait for held
  keys before an insertion.
- `apps/desktop-ui/src/lib/ipc/desktop-state.ts`: snapshot ordering and settings
  writes, separate from command invocation.

A successful value-returning call contains its result; a failed call contains
its error and cannot also contain a result.

DTO serialization is covered by shared Rust/TypeScript fixtures under
`packages/shared/fixtures/`. Configuration JSON remains extensible on the Rust side
for migrations and plugin configuration, while UI callers use `UserConfig`.

## State synchronization

`get_desktop_state` and `app://state-changed` use one snapshot:

```text
DesktopSnapshot
  revision
  activation: activationId, target window, selection, mode, external request
  window: visibility, profile
  settings: userConfig, sessionState
```

The prompts and limits of the AI actions are not state: the webview takes them
from `APP_CONFIG` in `@tyco/shared`.

The revision advances under the state mutex for every update. Initial reads,
events and settings write responses pass through the same revision gate. A delayed
response cannot replace a newer event. UI navigation also rejects older snapshots.
Window focus triggers a fresh read to recover from missed notifications.

`DesktopViewState` is a flat UI projection of these domains, not a wire payload.
Settings writes remain blocked until an authoritative snapshot arrives. Local state
patches are detached and serialized; configuration writes use a baseline for
conflict detection and merging.

After a mutation commits, notification failure is logged and does not change the
operation into a failed write. Actual storage and validation failures still reject.

## Windows and insertion

`hide_window`, `open_in_browser_and_hide` and `paste_into_target_and_hide` act on
the invoking webview and require `activationId`. Window operations verify the
requesting window and activation on the main thread. Text injection checks the
activation again after waiting for focus release. A stale request fails without
hiding the newly active window or pasting into its activation.

## What the webview may run, read or write

A script in the webview, e.g. one injected through a model answer, must not
run a command, read a file or write one the user never set up. `execute_script_action`
takes the id of a saved `script` command: the shell command, its working
directory and timeout are read from the saved config. The command editor saves
the draft before a test run and runs only what was saved. Notes are written
only by `write_plugin_note`, under a root the user approved for that plugin.
`read_dropped_file` reads only the paths of the last drop onto the window.
`install_plugin_package` installs the package the user picked in the dialog of
`pick_plugin_package`, by its `inspectionId`, never a path the webview names.
Network tasks are steered only by the window that started them.

## Chats and compatibility

`list_chats` returns `ChatSummary[]`, without messages. `get_chat` returns a full
`Chat | null`; `save_chat` accepts a full chat. The title field is `title`.
Attachments use objects containing `text` and optional source and file metadata.

Images live in session memory until a saved chat shows them; how the webview
holds them is described in `src-tauri/src/commands/chat_images.rs`.

Plugins use `openInBrowserAndHide`; removed SDK browser names are rejected.

## Verification

Run `pnpm validate:all` after changing the cross-language API. Contract tests cover
serialization, removed command names, required arguments and list/detail separation.
State tests cover delayed reads and writes, concurrent revisions, queued patches,
focus recovery and event handler failures.

Linux desktop notifications retain their D-Bus sender in an application-owned
`NotificationService`; a short-lived connection can make the desktop remove a
notification immediately. The command resolves the service and delegates the native
call. The service bounds native waits, rejects queued work on shutdown and shares
the runtime shutdown deadline. A failed notification is never automatically resent.

The read-only `get_text_insertion_status` command is shared by `main` and `quick`.
UI insertion capability accepts tracked targets and the backend's untracked
`focusReturn` path; `windowId` alone is not a cross-platform capability check.
