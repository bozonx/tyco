# Plan: grow the plugin API

The dialog stays an optional module of the app (`architecture.md`, Frontend
dependencies) rather than a plugin: a plugin dialog would need a plugin UI
runtime, streaming audio, STT and LLM, overlay windows and storage, designed
around a single consumer. The plugin API grows one capability at a time
instead, each added when a real plugin needs it.

## Capabilities

Each is a new `PluginCapability` the user grants explicitly, exposed to the
worker through the existing message port, with SDK types and tests
(`plugin-packages.md`):

1. `llm`: a request to the user's chosen LLM profile, with streaming and
   cancellation. Keys stay in the Rust secret store.
2. `storage`: per-plugin key-value and file storage in the data folder.
3. `stt`: the recognized text of a dictation session, no raw audio.
4. `panel`: a declarative panel or form rendered by the host.

Keep each API generic rather than shaped by the dialog.

## Revisit the dialog as a plugin

Once `llm`, `stt`, `storage` and panels exist and two or three plugins use
them, check what the dialog would still need (live audio streams, an overlay
window, a high-frequency custom view, a typed history block) and whether those
are worth a public contract. Until then the subtitles window stays a
dialog-only window: generalizing it has no second user.
