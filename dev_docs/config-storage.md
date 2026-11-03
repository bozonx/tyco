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
(Rust) — distinct entities, references that exist. The webview
uses them as they are (`normalizeUserConfig`, `normalizeCommands`,
`normalizeLlmConfig`, `normalizeConfigField`, `normalizeConfigValue`) and keeps
no rules of its own; the shared fixtures in `packages/shared/fixtures` check that
both runtimes give identical data. Only what the webview alone knows is added
there: the cached appearance and the plugin defaults.

The backend repairs malformed known settings on startup. Normalization fills
missing fields and stamps the current version. Only the current field names and
structure are supported: there are no migrations or aliases for earlier
development formats. Unknown fields are preserved as opaque data; their names
do not trigger conversion into current settings.

### Versions and compatibility

Format 1 ships with the first release. `configVersion` counts breaking changes
only, so that most releases leave it alone:

- **Compatible, the version stays**: a new field or section with a default, a
  new item type of a list or a grid, a wider range of a number. Both runtimes
  keep the fields they do not know as they are, through the repair, the merge
  and the save, so a config written by a newer build of the same version keeps
  its new settings when an older build opens and saves it. A new enum value is
  compatible too when an older build may fall back to the default of the field;
  the startup repair then keeps the file it read, see below.
- **Breaking, the version is raised**: a field renamed, moved or removed, a type
  or meaning changed, a constraint narrowed. Such a change comes with a migration
  from the previous version, run before the normalization.

A build never writes over a config of a newer version: it shows the settings
but saves nothing (`configIsNewer`).

The backend rejects invalid IPC saves before storing credentials or writing the config:
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

| Section           | Contents                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `appearance`      | `theme`, `contrast`, `motion`, `uiScalePercent` (50–300; the settings offer presets)                                        |
| `language`        | `ui` (interface locale or `auto`)                                                                                           |
| `editor`          | `submitKey`, `diffViewMode`, `history` (`storage`, `maxItems`, `retentionDays`, `isSecretSanitizingEnabled`, `isLocalOnly`) |
| `quickWindow`     | `isHiddenOnBlur`, `isCorrectionPrefetchEnabled`                                                                             |
| `hotkeys`         | one shortcut per activation mode a hotkey opens, named as the mode, `selectionCorrection`                                   |
| `externalAccess`  | `canAccessSelection`; each command allows external calls with `isAvailableExternally`                                       |
| `windowInsertion` | `linux`: `pasteShortcut`, `terminalPasteShortcut`; `terminalApps`: extra window classes treated as terminals                |
| `translation`     | `provider`, `providers.deepl.endpoint`, `qualityGate`, `glossary`, `targetLanguages` (a shortcut grid), `viewMode`          |
| `actionPages`     | pages of the action menu: each has `inputMode` (`selection` or `none`) and `slots` (a shortcut grid)                        |
| `commands`        | the commands of the user: `toolId`, `toolConfig`, `outputAction`, `isEnabled`, `isOutputLogged`, `platforms`, …             |
| `variables`       | the variables commands refer to as `{{var:NAME}}`: `id`, `name`, `description`                                              |
| `variableValues`  | the value of each variable on this device, by variable id (device)                                                          |
| `llm`             | `imageQuality`, `providers` (by `type`), `models`, `tasks`: per task its `modelId` and `rule` (see below)                   |
| `transformations` | `items`, the transformation library; `slots`, the transformation menu (a shortcut grid of transformation ids)               |
| `styling`         | `items`, the styling library; `slots`, the styling menu (a shortcut grid of styling ids)                                    |
| `aiVault`         | `path`, empty for the default location                                                                                      |
| `aiProfiles`      | `chatHistory` (`storage`: `off` or `disk`, `retentionDays`)                                                                 |
| `markdown`        | `format` (how the editor writes Markdown), `strip` (what is left of it in plain text)                                       |
| `plugins`         | per plugin id: `isEnabled` and the plugin-owned `settings`                                                                  |
| `chat`            | `history` (`storage`: `off` or `disk`, `retentionDays`)                                                                     |
| `stt`             | `provider`, `isVoiceCorrectionEnabled`, `providers.deepgram`, `providers.sherpaOnnx`                                        |

The hotkeys of `hotkeys` are named as the activation modes they open
(`quickInput`, `selectionActions`, `selectionActionsPage2`..`selectionActionsPage5`,
`translation`, …); the name is also the hotkey id the UI and the system portal use.
`selectionCorrection` corrects the selection in place. All five action page hotkeys
are configurable regardless of how many action pages currently exist.

The glossary is one for every target language: `{ "term", "translation" }`,
where a term kept as it is has itself as its translation. ai-kit's
`use`/`doNotTranslate` spelling is made only at the SDK boundary.

An LLM provider has the fields of its `type`: the built-in `google`,
`openrouter` and `deepseek` (each once, the id equal to the type) have `id`,
`type` and `name`; an `openaiCompatible` one has a `baseUrl` too. A model states
its capabilities explicitly with `canUseImages` and `canUseTools`; a new model
of a custom endpoint starts without tools.

A shortcut grid is an object keyed by the keys of `SHORTCUT_SLOT_KEYS`
(`q`…`b`, row by row); an empty slot is absent. A grid lays out entities kept
elsewhere and refers to them by id; `actionPages` and `targetLanguages`
hold the items themselves. Action pages are addressed by 1-based index
(`selectionActions` or `selectionActions:1` for page 1, `selectionActions:2` for page 2, etc.).

`llm.tasks` holds what each LLM task needs: `chat` (`rule`; the chat runs on
the model picked in it), `correction`, `voiceCorrection` (`modelId`,
`rule`; on when `stt.isVoiceCorrectionEnabled`), `translation` (`modelId`, `rule`, `qualityGateRule` for the review
pass) and `aiTask` (`modelId`; the model of every AI command, each of which
has its own prompt). `modelId` is
the one model that answers the task, empty when none is picked; a call that
fails is not retried on another model.

The standard items of the action menu (`type: "standard"`) are not the core
tools under another name: they are menu behaviors (the correction opens its
review, the insertion knows the target window, `transformationMenu`,
`stylingMenu` and `translationMenu` open a submenu). The core tools (`core.*`) serve commands,
which run headless.

Conventions:

- Key combinations are written as the hotkeys are: `Ctrl+Alt+V`, `Ctrl+Enter`,
  `Shift+Insert`. `Ctrl` is the Control key on every platform; `Super` is Cmd
  on macOS and the Windows key on Windows.
- Text that is not set is an empty string (`aiVault.path`, a hotkey, a tool
  path); a number that is not set is absent (model limits,
  `retentionDays`, which keeps everything without it). Zero is never a
  sentinel: a feature is turned off by its own field (`storage: "off"`).
- Ids of the user's entities (commands, models, transformations, styles,
  launcher pages)
  match `^[a-z0-9][a-z0-9._-]{0,63}$`; provider ids are at most 60 characters,
  as they go into secret ids. An entity with a malformed id is dropped.
- Locales are BCP 47 tags with a region: `en-US`, `ru-RU`.
- Booleans read as predicates: `is*`, `has*`, `can*`. A boolean that is not
  set is `false`; there is no hidden third state.
- Enum values are camelCase; SDK-specific spellings (e.g. ai-kit's
  `openai-compatible` and `sherpa-onnx`) are converted only at the SDK
  boundary.
- An id is stable and independent of the display name.

Script tools use `workingDirectory`; webhook tools use `isAuthEnabled` and
`authSecretId`; commands use `isLlmArgumentParsingEnabled`. The standard
menu actions `transformationMenu`, `stylingMenu` and `translationMenu` open a
menu to pick from; one transformation, style or language is an item of the
`transformation`, `styling` or `translation` type.

An AI command is a command of the `core.aiTask` tool. Its `toolConfig` holds
`prompt`, `allowedCommandIds` (the commands its agent may run; the command
itself never runs) and `maxSteps` (1–50, 5 by default), see
`dev_docs/design-ai-commands.md`.

A command may name the `platforms` it runs on (`linux`, `windows`; absent or
empty for every one). On another platform it stays in the config and in the
grids, shown unavailable, and does not run; normalization keeps the references
to it.

### Variables

A variable gives a command, or the base URL of an `openaiCompatible` provider,
a value that differs between devices: a folder, a local server. Its declaration
is the user's (`variables: [{ id, name, description }]`), its value the
device's (`variableValues: { "<variable id>": "<value>" }`, `x-scope: device`):
a device refers to the shared entity, and the value of a variable that is gone
is dropped. A name matches `^[A-Z][A-Z0-9_]*$`, is unique without case and
never starts with `TYCO_`, the prefix of the built-in `TYCO_USER_DIR` (the user
data folder) and `TYCO_DEVICE_ID`. Values are plain text and may go into a
prompt or a URL; keys stay in the secret store.

A template refers to a variable as `{{var:NAME}}` and is filled once before it
is used: what a value holds, `{{TEXT}}` or another `{{var:…}}`, stays text. A
variable without a value on this device (or not declared) stops the run, and the
error names it; an empty value is never put in quietly. The escaping follows the
place, as for `{{TEXT}}`:

- a script's `command`: the value goes by the environment, quoted for the shell
  (`shell::substitute_all`); every variable with a value is in the environment
  of the script as `TYCO_VAR_<NAME>`, the built-in ones under their own names,
  so a variable never stands in for one of the system;
- a script's `workingDirectory`: as it is, then `~` is expanded;
- a webhook's URL and plain header values: as they are (no line break in a
  header); its body by the rules of `{{TEXT}}`: escaped inside a JSON string, a
  JSON string of its own when bare;
- an AI command's `prompt` and a provider's `baseUrl`: as they are.

Plugin command fields have templates of their own and are not filled. The rules
live in `@tyco/shared` (`variables.ts`) and `services::variables`, checked by
`packages/shared/fixtures/variable-substitution.json`. Scripts are filled by the
backend; webhooks, AI commands and provider URLs by the webview, which gets the
values in the joined config. The backend fills the URLs too where it decides by
them: the origins the network policy allows and the origin a webhook header key
is bound to, which comes from the URL as it is on this device. A save checks the
template, not the value: a reference to an undeclared variable is accepted and
shown. Renaming a variable renames `{{var:…}}` in the fields that are filled and
in provider base URLs.

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

## User and device parts

The webview sees one `UserConfig`; only the backend splits it. A field or
section marked `"x-scope": "device"` in the schema belongs to this machine and
lives in the `config` of `device.json`; everything else is the user's and
lives in `config.json` of the user data folder, which may be synced. Both
adapters (`splitUserConfig`/`joinUserConfig` of `@tyco/shared`,
`schema::split_by_scope`/`join_scopes`) give the same parts; the fixtures of
`packages/shared/fixtures/config-scope.json` check it. `x-scope` never marks a
field inside a list item or a map entry: a device field may live in a user
section (`appearance.uiScalePercent`), never in a user entity.

The device fields are `hotkeys`, `windowInsertion`, `externalAccess`,
`appearance.uiScalePercent`, `aiVault.path`, `stt.providers.sherpaOnnx`,
`isInDevelopment`, `editor.history.isLocalOnly` and `variableValues`. An unknown field goes back
to the file it was read from, so a device field of a newer build never reaches
`config.json` through an older one. Both parts carry `configVersion`; when
either is newer than the build knows, the whole config is shown and never
saved (`configIsNewer`).

References go from the device to the user data only: a device value of an
entity is kept by the entity id (the shortcuts of launcher pages, the values of
variables, the notes folders of plugins, the folders of external projects), and
one whose entity is gone is dropped on that device. A config that was not read
(the folder is not connected, the file is broken or missing) says nothing about
which entities are gone: the device keeps its values then.

The notes folders of plugins are taken out of the plugin settings and the
commands and kept on the device (`pluginPaths`, `pluginCommandPaths` of
`device.json`), leaving empty strings in `config.json`; see
`plugin-packages.md`. Only a `config.json` that was read changes them: while
the user data folder is not connected, or its config is broken or missing, the
folders of the device stay as they are. The folder of a command a read config
no longer holds is dropped; that of a plugin without saved settings is kept.

`config.json` is the one file every device rewrites, so each save merges it
three ways with `config.base.json` of the state folder, the version this device
last read or wrote (`settings::persist`). A change another device synced
meanwhile survives; where both changed one field, the change just made here
wins, the version of the disk is kept in the recovery folder, and the windows
get `app://settings-conflict`. The merge comes first in a save, before the
hotkeys, the history settings and the keys are committed, so that they follow
the merged config; the write compares with the disk once more. A changed disk revision aborts
that attempt before committing; runtime reconciliation is retried at most three
times. Failure to preserve a losing conflict revision aborts the save. A startup
repair also leaves the original file untouched if its recovery copy cannot be
written. Without a base, e.g. after connecting another
folder, the disk is taken as it is. The storage watcher applies external revisions without rewriting the shared
file. It updates the base only after the runtime accepts the merged settings,
so local edits stay pending and a failed application can be retried. Invalid
or newer files leave the current settings and base intact. A startup repair writes a file only when the
repair changed a value, not when it only filled missing fields, so that two
builds of different versions do not rewrite the shared file in turns.

## Lifetime and locations

`SessionState` is shared across windows and lives only in backend memory. Last
chat, last model, activation mode and recent menu inputs reset on restart.
`editor.diffViewMode` and `translation.viewMode` are persistent user preferences
in the config. The browser's `localStorage.appearance` is a bootstrap cache to
avoid a flash before the authoritative config arrives.

Linux paths below honor XDG overrides. macOS and Windows use the platform paths
in `services/storage/app_paths.rs`; `TYCO_DEV_HOME` isolates development storage.

| Root                                                                             | Files                                                                                                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User data (`~/.local/share/com.tyco.app` by default, or a folder the user chose) | `tyco-user.json`; `config.json`; `history/editor/<device id>.jsonl`; `chats/<id>.json`, `images/`; `plugins/<key>.json` and `<key>.previous`; `ai-vault/` |
| Device (`~/.config/com.tyco.app`; `%LOCALAPPDATA%\com.tyco.app\device`)          | `device.json`, `secrets.json`                                                                                                                             |
| State (`~/.local/state/com.tyco.app`)                                            | `logs/`; `webview/`; `config.base.json`; `history/editor/local.jsonl`; `index/` (chat indexes, `orphan-images.json`); `recovery/`                         |
| Cache (`~/.cache/com.tyco.app`)                                                  | Platform cache directory, created when opened; no application-owned model downloads                                                                       |
| User-selected paths                                                              | Plugin note files; `aiVault.path`                                                                                                                         |

The user data folder holds everything the user made and set up, and nothing
else: it may be synced to other machines (Syncthing, Nextcloud, Dropbox,
OneDrive). Everything that belongs to one machine stays in the device, state
and cache folders. The device folder is never the user data folder nor inside
it; on Windows it is a subfolder of the local folder, never in the roaming one.
`device.json` holds the device part of the config and the fields of the device
itself: `deviceId` (a UUID made on the first start), `machineId`, through which
a copy of the device folder on another machine gets a new `deviceId`,
`userDataPath`, and the notes folders of plugins.

`tyco-user.json` (`{ "formatVersion": 1 }`) marks the user data folder; its
version counts layouts of the folder, apart from `configVersion`. The default
folder gets it when it has none, and what it holds already is used as it is. A
chosen folder that is missing, empty or has no marker is not connected:
nothing is created or written there, every write fails with
`userDataUnavailable`, and the main window offers to retry, to connect another
folder or to use the default one, since an empty set of data a sync tool spread
would wipe out the real one. A folder of a newer layout is read and never
written, including quarantine and directory creation. Cached paths are guarded
before mutations too. Losing the folder or its marker during a session blocks
further writes and requires a restart after the data returns. The watcher
publishes the disconnected state. Reading chats, journals and the default vault
needs no write access. The settings warn when other users may write into the chosen folder
(Linux): its commands run on this machine.

The folder is changed by `relocate_user_data` only (`desktop-api.md`), never by
a settings save, and the app restarts. `move` moves the known entries into an
empty folder; `connect` uses a folder with a marker of a known version and
leaves the current data where it is; a folder with Tyco files but no marker is
refused as a sync that has not finished; a folder with files of its own, or a
folder of the app, is refused. `resetToDefault` moves the data back only when
the default folder holds none; otherwise the user chooses `useDefault`, which
uses that data and moves nothing. The move is the one of the AI vault
(`storage::data_root_relocation`).

Copies kept aside (broken files, files before a repair or a salvage, the disk's
version that lost a merge) go to `recovery/` of the state folder at the path of
their file, never next to it in the user data folder. Temporary files of atomic
writes stay next to their file, named `.tyco-tmp-*`, so that a sync tool can
skip them. Every reader of the user data folder takes only names of its own
format and skips the conflicting copies and temporary files of sync tools
(`storage::user_files`); resolving the copies is left to a later version.
Three-way merging preserves already delivered independent edits; atomic rename
alone cannot prevent two machines writing the same base revision concurrently.
Keep synchronizer conflict copies for manual recovery until conflict resolution
is implemented. See `docs/data-folder.md` for setup and recovery.

The editor history is a journal per device: a device writes
`history/editor/<device id>.jsonl` only, reads the journals of every device and
merges them by time. A change to an entry of another device is a record of its
own journal (`delete`, `result`, `clear`); no journal of another device is
rewritten. The limits apply to the merged history when it is read; a device
compacts its own journal, keeping the records that still name an entry and its
latest `clear`. With `editor.history.isLocalOnly` the journal of the device is
`history/editor/local.jsonl` of the state folder, and moves over when the
setting changes. Times are the clocks of the devices: a clock that is off moves
entries in the order, nothing more.

A chat is its file, `chats/<id>.json`. The list is an index of the state folder
(`index/chats.json`, and `index/ai-vault/<digest of the vault path>/<profile>/`
for the chats of profiles), rebuilt from the files when their names, sizes or
modification times change; an earlier `chats/index.json` is not read.

A profile of the AI vault keeps `profile.json`, `SOUL.md`, its chats in `chats/`
(laid out as the app's own `chats/`) and its files in `workspace/`. Profile and
project folders are named by their ids, made once from the name (transliterated
to Latin) and never changed by a rename: chats, project permissions and the
`projects/<id>/` paths the model sees refer to them. Its `memory/` structure is
created with the profile; reading a profile does not recreate missing memory.

The vault is known by its marker `tyco-vault.json` (`formatVersion`, a
`vaultId` made once). The default vault, `ai-vault/` of the user data folder,
is made with its marker when it is not there. `aiVault.path` of a device is a
folder of its own, e.g. for git, Obsidian or a sync of its own; it may not lie
inside the user data folder. Such a folder is used only when it is there with
its marker. Folders without a marker are not adopted automatically. A missing
or empty folder is not connected:
nothing is made in its place, vault operations fail with `vaultUnavailable`,
and the profiles offer to pick a folder or the default one.

The description of a project (`projects/<id>/project.json`: `id`, `name`,
`description`, `isExternal`) is synced with the vault; the folder of an
external project is set on each device, in `aiProjectPaths` of `device.json`
by vault id, then project id. The webview gets it as `targetPath` of the
project; a save without one keeps the folder the device has. Creating an
external project asks for its folder; a project without one on this device is
listed as such, and its file tools fail with `projectUnavailable`, which the
model gets as the result of the tool. The model sees `projects/<id>/` whatever
the folder is. Writes into the memory of a profile are refused when the file
changed since the model read it, e.g. by another device.

`aiVault.path` is changed only by `relocate_ai_vault`, never by a settings save.
It moves the vault into an empty folder, or points the app at an empty folder or
an existing vault without moving anything, and gives the folder its marker; a folder holding other files is
refused (the settings offer a `tyco-vault` subfolder of it). A move renames each
top-level entry, or copies, checks and then removes it across disks, and moves
the entries back when it fails. Vault operations acquire shared access before
resolving the current path; relocation holds exclusive access through settings
publication or rollback. Settings saves and history maintenance acquire vault
access before the settings and history locks. Cross-disk copies are staged in
an exclusively created temporary directory and published without replacing an
existing destination. Failed rollback reports the remaining data locations. Timestamps
in the stored files are Unix milliseconds (`createdAt`, `updatedAt`,
`lastMessageAt`). A plugin file is named by the hex of its id, because ids that
differ only in case collide on a case-insensitive file system.

The config file belongs to the app; edits made by hand are unsupported, and a
malformed known value is repaired. Unknown fields are kept (see the versions
above). A startup repair that drops or replaces a value keeps the file it read
as `config.json.repaired-<digest>` and rewrites it; one that only fills missing
fields or stamps the version keeps none and leaves the file alone. Unreadable files are retained as
private `.broken-*` copies; up to 3 copies of a file are kept. Before JSONL
salvage, an exact copy named by its content digest is saved once, including
invalid UTF-8 bytes. Explicit editor-history clearing removes its damage copies
too. Temporary atomic write files may remain after a crash; successful writes
clean up their own files.

## Credentials and undo

A secret id names what the key is for: `llm.<provider id>`,
`translation.deepl`, `translation.google`, `stt.deepgram`, `webhook.auth.<uuid>`
and `webhook.header.<uuid>` (see `packages/shared/src/secret-ids.ts`). Ids of
earlier versions, digests included, stay valid as they are.

The values and `secrets.json` belong to the device and are never synced: each
machine has its own keys under the ids the shared config refers to. So an id
is made once, with the reference to it, and never changes: `authSecretId` when
a webhook first gets an authorization key, `webhook.header.<uuid>` when a
header first becomes secret. A key entered again goes under the id the config
has, at once and on this device only; the config does not change, and a
settings undo does not bring the old value back. The origins of a key are
those of the URL on this device. A key a device has no value for is a state,
not an error: the request is not sent, and the settings say that the key is not
set on this device. Newly created header secrets are rolled back when config
saving fails, unless restoring the config also fails and the disk's references
are uncertain.

After a successful save, obsolete header secrets are collected while retaining
references for commands still offered for undo. Final command removal waits for
successful config persistence, then removes unused authorization and header
secrets. The backend refuses deleting a key still referenced by the saved config.
Startup collects the unreferenced managed webhook secrets of this device, and
removes nothing from the config for a missing key; it does not run while the
user data folder is not connected or read only, when the config is newer, was
set aside as broken, or has a conflicting copy of a sync tool next to it, as
uncertain references keep the keys. A failed vault-only deletion keeps its metadata for a later retry.
The system vault holds the key values; `secrets.json` holds only their ids and
origins.

## Live storage updates

`storage::watcher` uses `notify` with a 250 ms debounce, plus a content scan
every 30 seconds on every filesystem (including network mounts). Window focus
requests another scan. The polling deadline is independent of debounce, and a
bounded signal queue coalesces busy event streams. SHA-256 revisions of mutable
entities detect equal-size edits even when a synchronizer preserves timestamps.
Scans cover TyCo data areas and skip unrelated root directories, `.git`, symlinks,
workspace trees, temporary files and conflict copies. Unreadable files retain
their previous revision without blocking changes to other files. Immutable,
content-addressed images use metadata fingerprints; polling does not open or
hydrate their content. Conflict resolution is a separate feature.

Atomic writes and entity removals publish `StorageEvent` revisions through an
internal broadcast bus. Only registered user/vault roots enter it; device
files and secrets do not. Matching disk echoes are suppressed, and consumed
local revisions are retired so a later external restoration is detected.
Local vault changes reach other windows without waiting for disk debounce.

The watcher invalidates chat indexes and cached search text, publishes editor history and plugin
updates, and sends relative paths in `app://storage-changed`. Idle, saved open
chats reload with a guard against changes made during I/O. Missing image previews
retry when their image file arrives, including profile images. A configured external
vault is observed separately; missing roots recover through polling without
being created. A reappearing user-folder marker offers a restart on the missing
folder screen; it never connects the folder in the running process.
