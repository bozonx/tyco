# Plan: isolate the dialog and grow the plugin API

The dialog (call transcript with live translation, `docs/dialog.md`) sits
apart from the app's core job, text input. Moving it into a plugin now would
need a plugin UI runtime, streaming audio/STT/LLM, window control and
storage APIs designed around a single consumer. Instead the dialog is
isolated inside the app first, and the plugin API grows one capability at a
time. Moving the dialog to a plugin is revisited once those APIs exist and
other plugins use them.

## Done

- `dialog.isEnabled` (default `true`) with a switch in Settings → Dialog.
  Off: the nav tab is hidden, the `/dialog` route redirects home, an open
  view goes to the editor, a running dialog stops and is saved to history.
- `DialogView` is a lazily loaded route, and the dialog store with
  `lib/dialog/*` loads with it: the nav tab reads `stores/dialog-status`, which
  the dialog store keeps up to date.
- Service seams: the `lib/dialog/*` models already take their capture, STT,
  translation and history dependencies injected; `stores/dialog.ts` is the
  only place that wires them to other features. Further interfaces would add
  nothing until a second consumer (a plugin API) exists.

## Step 1: finish the isolation inside the app

1. **Generic history entries.** `EditorHistoryEntry.dialog`
   (`src-tauri/src/models/editor_history.rs`) hard-wires the dialog into the
   history format. Replace it with a generic `source: { kind, meta }` block
   that features register a renderer for. This changes the stored journal
   format: needs a compatible reader for old entries (`config-storage.md`)
   and history tests on both sides.
2. **Subtitles window.** `services/runtime/subtitles_window.rs` is a
   dialog-only window. Generalize it into an "overlay strip" service that
   takes a published view, so another feature could reuse it.

## Step 2: plugin capabilities, one at a time

Each is a new `PluginCapability` the user grants explicitly, exposed to the
worker through the existing message port, with SDK types and tests:

1. `llm` — a request to the user's chosen LLM profile, with streaming and
   cancellation. Keys stay in the Rust secret store.
2. `storage` — per-plugin key-value and file storage in the data folder.
3. `stt` — recognized text of a dictation session (no raw audio).
4. `panel` — a declarative panel/form UI rendered by the host.

Add a capability only when a real plugin needs it; keep the API generic
rather than shaped by the dialog.

## Step 3: revisit "dialog as a plugin"

When `llm`, `stt`, `storage` and a panel UI exist and two or three other
plugins use them, check what the dialog still needs (live audio streams,
overlay windows, a custom high-frequency view) and decide whether these are
worth a public contract. If they are not, the dialog stays an optional core
module.
