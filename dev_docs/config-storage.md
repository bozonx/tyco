# Configuration and persistent files

`config.json` is a JSON object with camelCase keys, written in the order of its
fields. The supported schema version is `1` and comes from
`packages/shared/src/config-version.json`. Portable defaults come from
`user-config-defaults.json`; the Rust backend overrides only the platform
hotkeys. `user-config-schema.json` describes known fields, with `defaultPath`
pointing into those defaults. The two schema adapters support only the keywords
used by this checked-in schema (`propertyNames` included), not arbitrary JSON
Schema.

One set of rules normalizes the config: the schema, then the domain rules of
`normalizeUserConfig` (`@tyco/shared`) and `schema::normalize_user_config`
(Rust) — trimmed ids, distinct entities, references that exist. The webview
uses them as they are (`normalizeUserConfig`, `normalizeCommands`,
`normalizeLlmConfig`, `normalizeConfigField`, `normalizeConfigValue`) and keeps
no rules of its own; the shared fixtures in `packages/shared/fixtures` check that
both runtimes give identical data. Only what the webview alone knows is added
there: the cached appearance and the plugin defaults.

The backend repairs malformed known settings on startup and drops unknown
fields. Only the current field names and structure are supported: there are no
migrations or aliases for earlier development formats. Normalization fills
missing fields and stamps the current version.
It rejects invalid IPC saves before storing credentials or writing the config:
counts must be safe nonnegative integers, entity ids and translation languages
must be unique, and command, task, provider, model and launcher references must
exist. Opaque plugin settings and plugin tool config remain plugin-owned. A newer
schema version is rejected without modifying the file.

The config holds settings only, no state: nothing records what the app added
by itself, because it adds nothing. Tools (core and plugin) are registered at
runtime and are not stored; `commands` holds only the commands the user made
from them.

## Structure

The normalized `UserConfig` type has every section present. Serialized input
is untrusted `UserConfigInput` and must pass through normalization before use.

| Section           | Contents                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `appearance`      | `theme`, `contrast`, `motion`, `uiScalePercent`                                                              |
| `language`        | `ui` (interface locale or `auto`), `user` (the locale the user speaks and writes, or `auto`)                 |
| `editor`          | `submitKey`, `diffViewMode`, `history` (`storage`, `maxItems`, `retentionDays`, `isSecretSanitizingEnabled`) |
| `quickWindow`     | `isHiddenOnBlur`, `isCorrectionPrefetchEnabled`                                                              |
| `hotkeys`         | one shortcut per activation mode a hotkey opens, named as the mode, and `selectionCorrection`                |
| `externalAccess`  | `canAccessSelection`; each command allows external calls with `isAvailableExternally`                        |
| `windowInsertion` | `pasteShortcut`; `linux.method` (`auto`, `xdotool`, `ydotool`), `linux.xdotoolPath`, `linux.ydotoolPath`     |
| `translation`     | `provider`, `providers.deepl.endpoint`, `qualityGate`, `glossary`, `targetLanguages` (a shortcut grid)       |
| `mainActions`     | the action menu (a shortcut grid)                                                                            |
| `launcherPages`   | `id`, `inputMode`, `hotkey`, `slots` (a shortcut grid of command ids)                                        |
| `commands`        | the commands of the user: `toolId`, `toolConfig`, `outputAction`, `isEnabled`, `isOutputLogged`, …           |
| `llm`             | `providers`, `models`, `taskModelChains` (`translation`, `correction`, `voiceCorrection`, `aiTask`)          |
| `aiRules`         | `chat`, `correction`, `translation`, `translationQualityGate`, `voiceCorrection`                             |
| `aiTasks`         | the task library: `id`, `name`, `rule`                                                                       |
| `aiTaskSlots`     | the AI task menu: task ids (a shortcut grid)                                                                 |
| `aiVault`         | `path`, empty for the default location                                                                       |
| `markdown`        | `format` (how the editor writes Markdown), `strip` (what is left of it in plain text)                        |
| `plugins`         | per plugin id: `isEnabled` and the plugin-owned `settings`                                                   |
| `chat`            | `imageQuality`, `history` (`storage`: `off` or `disk`, `retentionDays`)                                      |
| `stt`             | `provider`, `isLlmFormattingEnabled`, `providers.deepgram`, `providers.sherpaOnnx`                           |

A shortcut grid is an object keyed by the keys of `SHORTCUT_SLOT_KEYS`
(`q`…`b`, row by row); an empty slot is absent. A grid lays out entities kept
elsewhere and refers to them by id; only `mainActions` and `targetLanguages`
hold the items themselves. Launcher pages have stable ids: main actions refer
to them through `pageId`, and a page opens with the activation mode
`commandLauncher:<page id>`. The overlay itself opens on its first page; a
hotkey belongs to the page that it opens. At least one page is required.

Conventions:

- Key combinations are written as the hotkeys are: `Ctrl+Alt+V`, `Ctrl+Enter`,
  `Shift+Insert`.
- Text that is not set is an empty string (`aiVault.path`, a hotkey, a tool
  path); a number that is not set is absent (`timeoutSec`, model limits).
- Booleans read as predicates: `is*`, `has*`, `can*`.
- Enum values are camelCase; SDK-specific spellings (e.g. ai-kit's
  `openai-compatible` and `sherpa-onnx`) are converted only at the SDK
  boundary.
- An id is stable and independent of the display name.

Script tools use `workingDirectory`; webhook tools use `isAuthEnabled` and
`authSecretId`; commands use `isLlmArgumentParsingEnabled`. The standard
menu actions `aiTaskMenu` and `translationMenu` open a menu to pick from; one
task or language is an item of the `aiTask` or `translation` type.

Voice invocation is opt-in per command: `isVoiceEnabled` defaults to `false`.
Whether a recognized command runs at once is a choice of the voice overlay, not
of the command. `phrases` are literal strings, one synonym per entry.
`hotkeys.voiceCommands` opens the separate voice command overlay and is
unassigned by default. The voice catalog is independent of `launcherPages` and
`isAvailableExternally`.

Every save writes the whole config atomically. Concurrent window edits use a
three-way merge: objects merge field by field, entity lists (items with an
`id`) merge item by item and keep the order one side changed; editing the same
field, or reordering differently in both windows, is rejected explicitly.

## Lifetime and locations

`SessionState` is shared across windows and lives only in backend memory. Last
chat, last model, activation mode and recent menu inputs reset on restart.
`editor.diffViewMode` and `translation.viewMode` are persistent user preferences
in the config. The browser's `localStorage.appearance` is a bootstrap cache to
avoid a flash before the authoritative config arrives.

Linux paths below honor XDG overrides. macOS and Windows use the platform paths
in `services/app_paths.rs`; `TYCO_DEV_HOME` isolates development storage.

| Root                                  | Files                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config (`~/.config/com.tyco.app`)     | `config.json` and up to 3 `config.json.repaired-<unix ms>` snapshots, `secrets.json`                                                                                       |
| Data (`~/.local/share/com.tyco.app`)  | `editor-history.jsonl`; `chats/index.json`, `<id>.json`, `images/`, `chat-transaction.pending`; `plugins/<key>.json` and `<key>.previous`; `ai-vault/`; `webview/` (Linux) |
| State (`~/.local/state/com.tyco.app`) | `logs/tyco.log` and its rotations; `logs/actions.log` and `actions.log.1`; `webview/` (Windows)                                                                            |
| Cache (`~/.cache/com.tyco.app`)       | Platform cache directory, created when opened; no application-owned model downloads                                                                                        |
| User-selected paths                   | Plugin note files; `aiVault.path`                                                                                                                                          |

A profile of the AI vault keeps `profile.json`, `SOUL.md`, its chats in `chats/`
(laid out as the app's own `chats/`) and its files in `workspace/`. Timestamps
in the stored files are Unix milliseconds (`createdAt`, `updatedAt`,
`lastMessageAt`). A plugin file is named by the hex of its id, because ids that
differ only in case collide on a case-insensitive file system.

Config snapshots remove API-key fields and webhook headers. A startup repair
takes one snapshot of the file it replaces. Unknown core
fields are rejected on save; startup repairs keep the original mapping in a
snapshot before removing unsupported fields. Unreadable files are retained as
private `.broken-*` copies; up to 3 copies of a file are kept. Before JSONL
salvage, an exact copy named by its content digest is saved once, including
invalid UTF-8 bytes. Explicit editor-history clearing removes its damage copies
too. Temporary atomic write files may remain after a crash; successful writes
clean up their own files.

## Credentials and undo

A secret id names what the key is for: `llm.<provider id>`,
`translation.deepl`, `translation.google`, `stt.deepgram`, `webhook.auth.<uuid>`
and `webhook.header.<digest>` (see `packages/shared/src/secret-ids.ts`).

New webhook authorization keys use independent `webhook.auth.<uuid>` identities
stored as `authSecretId` references; re-entering a key creates a fresh identity. Header values
are replaced by origin-bound `tyco-secret:` references. Newly created header
secrets are rolled back when config saving fails, unless restoring the config
also fails and the disk's references are uncertain.

After a successful save, obsolete header secrets are collected while retaining
references for commands still offered for undo. Final command removal waits for
successful config persistence, then removes unused authorization and header
secrets. The backend refuses deleting a key still referenced by the saved config.
Startup collects unreferenced managed webhook secrets when no drafts or undo
operations exist. A failed vault-only deletion keeps its metadata for a later retry.
The system vault holds the key values; `secrets.json` holds only their ids and
origins.
