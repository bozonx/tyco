# Desktop API

Rust command signatures are the source of truth for the native command surface.
Run `pnpm generate:desktop` after changing a command. `pnpm check:architecture`
rejects stale bindings, missing registration and missing explicit permissions.
Unsupported Rust signature types fail generation rather than becoming `any`.

## Contracts and adapters

- `packages/shared/src/desktop-commands.ts`: generated names, arguments and results.
- `packages/shared/src/desktop/`: domain DTOs, events and error contracts.
- `packages/shared/src/desktop-transport.ts`: channel and transport DTOs.
- `apps/desktop-ui/src/lib/desktop/invoke.ts`: the native boundary; rejects with
  `DesktopIpcError` for coded Rust failures. Binary file-import errors retain their
  specialized payload.
- `apps/desktop-ui/src/lib/ipc/functions/`: domain function argument tuples.
- `apps/desktop-ui/src/lib/ipc/*-command-map.ts`: typed adapters from domain
  functions to generated native commands. Results are inferred from Rust bindings.
- `apps/desktop-ui/src/lib/ipc/desktop-state.ts`: snapshot ordering and settings
  writes, separate from command invocation.

Native adapters (network, microphone and images) use rejected promises. The UI
command facade converts those failures into the discriminated `IpcResult` union.
A successful value-returning operation must contain its result; a failed operation
must contain its error and cannot also contain a result.

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
  settings: userConfig, sessionState, appConfig
```

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

## Chats and compatibility

`list_chats` returns `ChatSummary[]`, without messages. `get_chat` returns a full
`Chat | null`; `save_chat` accepts a full chat. The title field is `title`.
Attachments use objects containing `text` and optional source and file metadata.

Plugins use `openInBrowserAndHide`; removed SDK browser names are rejected.

## Verification

Run `pnpm validate:all` after changing the cross-language API. Contract tests cover
serialization, removed command names, required arguments and list/detail separation.
State tests cover delayed reads and writes, concurrent revisions, queued patches,
focus recovery and event handler failures.
