# Configuration and persistent files

`userConfig.json` is a JSON object with camelCase keys. The supported schema
version comes from `packages/shared/src/config-version.json`. Portable defaults
come from `user-config-defaults.json`; the Rust backend overrides only platform
hotkeys and insertion binaries. `user-config-schema.json` describes known fields,
with `defaultPath` pointing into those defaults. The two schema adapters support
only the keywords used by this checked-in schema, not arbitrary JSON Schema.
Shared normalization fixtures verify that both adapters produce identical data.

The backend repairs malformed known settings on startup and drops unknown
fields. Older configs are not migrated: they are repaired against the current
schema and stamped with the current version.
It rejects invalid IPC saves before storing credentials or writing the config:
counts must be safe nonnegative integers, entity ids must be unique, and command,
task, provider, model and launcher references must exist. Opaque plugin settings
and plugin tool config remain plugin-owned. A newer schema version is read-only.

The portable `registrationState` ledger has separate `reviewedMainActionIds`,
`seededCommandIds`, and `seededToolIds`; it travels with the user's configuration
so deleted defaults do not return on another installation.

Every save writes the whole config atomically. Concurrent window edits use a
three-way merge; conflicting arrays are rejected explicitly.

## Lifetime and locations

`SessionState` is shared across windows and lives only in backend memory. Last
chat, last model, activation mode and recent menu inputs reset on restart.
`diffViewMode` and `translationViewMode` are persistent user preferences in the
config. The browser's `localStorage.appearance` is a bootstrap cache to avoid a
flash before the authoritative config arrives.

Linux paths below honor XDG overrides. macOS and Windows use the platform paths
in `services/app_paths.rs`; `TYCO_DEV_HOME` isolates development storage.

| Root                                  | Files                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Config (`~/.config/com.tyco.app`)     | `userConfig.json`, latest `userConfig.repaired.bak`, `secrets.json`                                                                                                      |
| Data (`~/.local/share/com.tyco.app`)  | `history/editor-history.jsonl`; `chats/index.json`, `<id>.json`, `images/`, `chat-transaction.pending`; `plugins/<key>.json` and `<key>.previous`; Linux webview storage |
| State (`~/.local/state/com.tyco.app`) | `logs/tyco.log` and its rotations; `logs/actions.log` and `actions.log.1`                                                                                                |
| Cache (`~/.cache/com.tyco.app`)       | Platform/app cache directory; no application-owned model downloads                                                                                                       |
| User-selected paths                   | Plugin note files                                                                                                                                                        |

Config backups remove API-key fields and webhook headers. Unknown core
fields are rejected on save; startup repairs keep the original mapping in a
backup before removing unsupported fields. Unreadable
files are retained as private `.broken-*` copies. Before JSONL salvage, an exact
copy named by its content digest is saved once, including invalid UTF-8 bytes.
Explicit editor-history clearing removes its damage copies too. Temporary atomic
write files may remain after a crash; successful writes clean up their own files.

## Credentials and undo

New webhook authorization keys use independent `webhook-auth-<uuid>` identities
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
