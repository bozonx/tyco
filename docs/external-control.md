# External control: CLI and D-Bus

Tyco exposes a deliberately limited API for local desktop integration. It does
not expose arbitrary Tauri functions, secret management, plugin installation,
or configuration writes. The CLI and D-Bus share one Rust authorization and
execution dispatcher.

## Prerequisites and transports

Tyco must already be running. Install `tyco-ctl` in `PATH` (on Windows,
`tyco-ctl.exe`). Build the client with:

```sh
cargo build --manifest-path src-tauri/Cargo.toml -p tyco-ctl --release
```

There is no TCP listener and no network fallback.

| Platform | CLI transport | Access boundary                            |
| -------- | ------------- | ------------------------------------------ |
| Linux    | Unix socket   | Current UID; private directory and socket  |
| Windows  | Named pipe    | Current logon SID; remote clients rejected |
| macOS    | Unix socket   | Current UID; private directory and socket  |

On Unix the endpoint is `$XDG_RUNTIME_DIR/tyco-control/control.sock`. Without
`XDG_RUNTIME_DIR`, it is under the system temporary directory at
`tyco-<uid>/tyco-control/control.sock`. The base and control directories must be owned by
the current UID with mode `0700`; the socket has mode `0600`. A lifetime lock
prevents two servers from racing to remove a stale socket. Both ends check
peer credentials. An insecure directory is rejected rather than repaired.

On Windows the name is `\\.\pipe\tyco-control-<logon-sid>`. The server uses an
explicit protected DACL for that logon SID, rejects remote clients, and claims
the first pipe instance exclusively. A client in a different login session
cannot use this endpoint even if it belongs to the same account.

Linux also exposes the session-bus service `org.tyco.Service`, object
`/org/tyco/Object`, public interface `org.tyco.Interface`. The service must
already be running; this API does not install D-Bus activation files.

Local access does not identify a trusted application: an allowed command may
be invoked by other processes with access to the same user/session boundary.
There is no per-script identity or per-client grant system.

## Open the text action chooser

Use `select` to open the action menu for text. Use `command-launcher` for the
searchable library command chooser. Both accept explicit text or the current
selection; opening either without input does not capture the selection.

```sh
# Open the text action menu for the current selection.
tyco-ctl open select --selection

# Open the text action menu with supplied text.
tyco-ctl open select --text 'Please improve this text.'

# Open the searchable command chooser for the current selection.
tyco-ctl open command-launcher --selection
```

On Linux the same windows can be opened through the session bus:

```sh
# Open the text action menu for the current selection.
busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface Open ssb \
  select '' true

# Open the text action menu with supplied text.
busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface Open ssb \
  select 'Please improve this text.' false

# Open the searchable command chooser for the current selection.
busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface Open ssb \
  commandLauncher '' true
```

Selection capture requires **Allow external selection capture and replacement**.
Executing an external library command also requires the master command grant
and that command's individual grant. Supplied text is visible in process
arguments; use `tyco-ctl run --stdin` for private scripted input.

## Permissions

Settings → Commands contains three independent controls:

- **Allow external command execution**: master switch for library commands.
  Every command additionally requires its own external permission and must be
  enabled. Enabling the master switch does not expose all commands.
- **Allow external selection capture and replacement**: permits explicit
  `--selection`, `--replace`, and selection actions.
- **Allow external recording activation**: permits opening `voice`,
  `voice-chat`, and `write`, which can start recording.

The defaults are `commands: true`, `selection: false`, `recording: false`.
Existing individual command grants are preserved. Select commands in the settings
list to grant or revoke external access in bulk; this changes only those selected
commands and does not grant access to future commands. Newly created and seeded core/plugin
commands are not automatically granted external access. Internal hotkeys and
UI actions do not acquire external permissions merely because they share the
underlying execution code.

The corresponding user configuration is:

```yaml
externalAccess:
  commands: true
  selection: false
  recording: false
```

A command's external grant does not bypass its tool's availability or permission
checks. `confirm: always` requires interactive user confirmation; there is no
`--yes` bypass. Permission and command configuration are checked again when the
quick webview claims a job. A command changed after submission is rejected
with `ConfigurationChanged` instead of executing a stale configuration.

## CLI

```text
 tyco-ctl status
 tyco-ctl open <mode> [--text TEXT | --selection]
 tyco-ctl commands <list [--json] | describe <id> [--name]>
 tyco-ctl run <id> [--name] [--text TEXT | --stdin | --input-json JSON | --selection]
              [--replace] [--interactive] [--output return|configured]
              [--wait] [--json] [--timeout SECONDS]
 tyco-ctl jobs <status|cancel|wait> <job-id> [--json] [--timeout SECONDS]
 tyco-ctl quit
```

`--help` and `--version` work without a running Tyco instance.

### Open the UI

```sh
tyco-ctl open editor
tyco-ctl open settings
tyco-ctl open chat --text 'Explain this paragraph'
tyco-ctl open editor --selection
```

Modes: `editor`, `write`, `chat`, `voice-chat`, `voice`, `select`, `ai-tasks`,
`command-launcher`, `correction`, `translate`, `history`, `settings`.
The old camelCase spellings and `config` remain valid aliases.

Opening UI does not implicitly capture a selection. `--selection` captures
before opening the window and requires the selection permission. It restores
the clipboard after capture. Later changes to clipboard content are preserved. Opening recording modes requires the recording
permission.

### Discover commands

```sh
tyco-ctl commands list --json
tyco-ctl commands describe default:core.correct:fix
tyco-ctl commands describe 'My command' --name
```

Lists and descriptions are JSON. The list includes currently callable commands,
with `id`, `name`, `input`, `confirmationRequired`, `canReplaceSelection`, and
`afterRun`. A structured input is marked `structured`; a description also
includes `textAccepted` and the tool's `inputSchema` when the catalog provides
one. Command-specific schema overrides are validated by the executing tool
registry. Disabled, denied, missing, or unavailable commands return a coded
error when described. A disabled master command switch yields an empty list.

Use stable IDs in scripts. `--name` explicitly selects a display name, ignoring
case and redundant whitespace; an ambiguous name is rejected. Display names
can change with configuration or localization.

### Execute and return the result

```sh
tyco-ctl run default:core.correct:fix --stdin --wait < draft.txt > corrected.txt
tyco-ctl run my-backup --wait
tyco-ctl run my-reminder --input-json '{"at":"18:00","message":"Call"}' --wait
```

These commands require individual external grants. A normal `run` is
non-interactive. Missing text returns `InputRequired`; required confirmation
returns `ConfirmationRequired`. It does not open a window, capture a selection,
or perform the command's configured after-run action implicitly.

`--stdin` preserves the input exactly, including trailing newlines. `--text`
also preserves the supplied argument. Both text and JSON are limited by the
1 MiB serialized protocol frame limit. JSON must be an object and is validated
against the effective tool input schema without LLM argument parsing. Explicit
JSON is useful for structured tools that cannot parse ordinary text.

Input sources are mutually exclusive. Supplying input to a command with no
input is an error. Explicitly empty text remains an input; the tool decides
whether it is valid. The CLI does not trim, normalize, or silently drop it.
Use stdin for private text; command-line arguments may appear in process lists.

By default, tool content is returned in the job's `output`. `--wait` writes that
content to stdout exactly, without adding a newline. `--wait --json` instead
prints the complete final job object. A tool can have its own intrinsic side
effects (for example a webhook, script, `core.copy`, or `core.insert`); choosing
returned output does not undo or disable those effects.

`--output configured` applies the command's `afterRun` behavior. Commands that
show a result menu require `--interactive`; use returned output for pipelines.

### Interactive execution and selection

```sh
tyco-ctl run my-command --interactive --wait
tyco-ctl run default:core.correct:fix --selection --replace --interactive --wait
tyco-ctl run my-transform --selection --wait
```

Interactive execution may ask for input or confirmation. It never implicitly
uses a selection. `--selection` captures the focused application's selected
text; without `--replace`, the output is returned and the old clipboard is
restored when the job ends. `--replace` requires `--selection`, overrides configured after-run output handling, and inserts the
result back into the original target. Empty replacement output is a failure.

A changed foreground window prevents insertion: the result remains in the
clipboard, the job fails with `SelectionFailed`, and its output remains
available for recovery. An interactive confirmation window is hidden before
replacement so focus can return to the target. No window is forcibly focused
when an unrelated application has taken focus.

Selection jobs are exclusive. A second external invocation returns a busy/
selection error; it does not toggle cancellation of the first one. Internal
selection hotkeys also cannot cancel an active external selection job.

Windows capture uses `Ctrl+C`, insertion uses `Ctrl+V` (`Ctrl+Shift+C/V` in
recognized terminal windows), and clipboard snapshots
preserve HGLOBAL-backed formats. Handle-backed clipboard formats or snapshots
over 16 MiB are rejected before mutation. Elevated target applications may
reject simulated input from a non-elevated Tyco process. Linux selection capture
uses the existing platform clipboard/window tracking and key injection support.
macOS selection replacement is currently unsupported and returns a selection
error; ordinary command execution still uses the Unix transport.

### Jobs, completion, and cancellation

Without `--wait`, `run` returns a JSON job object immediately:

```json
{ "id": "job-1234-1", "commandId": "my-backup", "state": "accepted" }
```

```sh
tyco-ctl jobs status job-1234-1
tyco-ctl jobs wait job-1234-1 --timeout 60 --json
tyco-ctl jobs cancel job-1234-1
```

States: `accepted`, `running`, `succeeded`, `failed`, `cancelled`. `accepted`
means dispatch succeeded, not that the tool completed. A job has optional
`output`, `error`, and `code` fields. Completion is single-use; late results
cannot overwrite cancellation. Cancel is idempotent for a retained terminal job.

Cancellation aborts the tool signal and restores an outstanding selection
snapshot. A tool may already have performed irreversible side effects; cancel
is not rollback. Leaving a prepared interactive request cancels it.

Jobs are in-memory and disappear when Tyco exits. At most 32 jobs may be active;
at most 128 are retained, evicting the oldest terminal jobs first. Jobs that do
not finish within 300 seconds are cancelled with `TimedOut`. Returned output
is capped at 512 KiB and must also fit the escaped 1 MiB protocol envelope. Oversized output fails with `OutputTooLarge`.

Client `--timeout` controls waiting (default 300, range 1–3600 seconds). A client
wait timeout does not itself cancel the job; use `jobs cancel` explicitly. Local
IPC frames have a 10-second read/write deadline and a 1 MiB limit. Idle clients
do not block the listener; connections are bounded.

### Exit codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| 0    | Request accepted, or successful completion when waiting |
| 2    | Invalid arguments/input or missing input                |
| 3    | Permission denied or interactive confirmation required  |
| 4    | Service/command unavailable, not ready, or not found    |
| 5    | Execution or other API failure                          |
| 6    | Timeout                                                 |
| 7    | Cancellation                                            |

Use `--wait` when the calling script needs the tool's success or failure.
Machine error codes are stable identifiers separate from human-readable text.

## D-Bus

D-Bus is limited to interactive desktop actions on Linux. Use `tyco-ctl` for
command discovery, background execution, job monitoring/cancellation, status,
and quitting the application. Both transports share the authorization dispatcher.

| Method             | Input                                       | Output |
| ------------------ | ------------------------------------------- | ------ |
| `Open`             | mode string, text string, selection boolean | None   |
| `ReplaceSelection` | action string                               | None   |

`Open` uses the supplied text when selection is false. When selection is true,
it captures the current selection instead. `ReplaceSelection` uses the same
selection execution as `tyco-ctl run <id> --selection --replace --interactive`.
Its action must be `command:<id>` with a stable library command ID.

```sh
busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface Open ssb \
  select '' true

busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface ReplaceSelection s \
  'command:my-correction'
```

Methods return standard D-Bus errors with the machine error code in the message.
Successful calls acknowledge activation; they do not return command results or
wait for completion. Use `tyco-ctl run` and `tyco-ctl jobs` for observable execution.

KWin reports use the separate `org.tyco.KwinTracker` interface at the same
object. `KwinWindowActivated`, `KwinWindowClosed`, and `KwinWindowMissing` are
internal methods: they accept only the current owner of `org.kde.KWin`, not
ordinary API clients.
