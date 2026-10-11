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
busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface \
  OpenWithSelection s select

# Open the text action menu with supplied text.
busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface \
  OpenWithText ss select 'Please improve this text.'

# Open the searchable command chooser for the current selection.
busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface \
  OpenWithSelection s command-launcher
```

Selection capture requires **Allow external selection capture and replacement**.
Executing an external library command also requires the master command grant
and that command's individual grant. Supplied text is visible in process
arguments; use `tyco-ctl run --stdin` for private scripted input.

## Permissions

Each library command is allowed on its own: the terminal icon in its row in
Settings → Commands, or **Available from outside** in its settings. The command
must also be enabled. Newly created and seeded core/plugin commands are not
granted external access.

The **External access** section below the list holds one capability that is
independent of the command grants:

- **Read and replace selected text**: permits explicit `--selection`,
  `--replace`, and selection actions.

It is off by default. Internal hotkeys and UI actions do not acquire external
permissions merely because they share the underlying execution code.

While it is off, `tyco-ctl run <id> --selection` does not fail at once: Tyco
captures the selection and asks the user in its quick window whether the call
may use it. **Allow once** runs this call only, **Always allow** turns the
permission on, and **Deny**, Esc or closing the prompt fails the job with
`AccessDenied`. The prompt cannot tell which application is asking. One prompt
is shown at a time; another such call meanwhile fails with `AccessDenied`. A
prompt left unanswered ends with the job's timeout. `open --selection` still
requires the permission and does not ask.

Opening a mode that records, such as `voice`, `voice-chat` or `write`, needs no
permission: the recording happens in a visible Tyco window and nothing of it is
returned to the caller. Hotkeys bound in the desktop's own configuration, as on
Hyprland and Sway, run `tyco-ctl open voice` and rely on that.

The corresponding user configuration is:

```yaml
externalAccess:
  selection: false
```

Configs before version 3 also had `externalAccess.commands`, a master switch
for all commands. The migration drops it; a config where it was `false` has the
external grant of every command revoked instead. An `externalAccess.recording`
left from older builds is ignored and dropped on the next save from Settings.

A command's external grant does not bypass its tool's availability or permission
checks. Permission and command configuration are checked again when the
quick webview claims a job. A command changed after submission is rejected
with `ConfigurationChanged` instead of executing a stale configuration.

## CLI

```text
 tyco-ctl status
 tyco-ctl open <mode> [--text TEXT | --selection]
 tyco-ctl commands list [--json]
 tyco-ctl commands describe <id | --name NAME>
 tyco-ctl run <id | --name NAME> [--text TEXT | --stdin | --input-json JSON | --selection]
              [--replace] [--interactive] [--output return|configured]
              [--wait] [--json] [--timeout SECONDS]
 tyco-ctl jobs <status|cancel|wait> <job-id> [--json] [--timeout SECONDS]
 tyco-ctl quit
```

`--help` and `--version` work without a running Tyco instance.

`status` prints a JSON object with `apiVersion`, the app `version`, and the
`externalAccess` capabilities that are currently allowed.

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
the clipboard after capture. Later changes to clipboard content are preserved.

### Discover commands

```sh
tyco-ctl commands list --json
tyco-ctl commands describe default:core.correct:fix
tyco-ctl commands describe --name 'My command'
```

`commands list` prints one `id<TAB>name` line per command; `--json` prints the
full list instead. Descriptions are always JSON. The list includes the commands
that are currently callable, with `id`, `name`, `input`,
`canReplaceSelection`, and `afterRun`. A structured input is marked `structured`; a description also
includes `textAccepted` and the tool's `inputSchema` when the catalog provides
one. Command-specific schema overrides are validated by the executing tool
registry. Disabled, denied, missing, or unavailable commands return a coded
error when described.

Use stable IDs in scripts. Without `--name` the target is only ever an ID.
`--name` explicitly selects a display name, ignoring case and redundant
whitespace; an ambiguous name is rejected with `AmbiguousName`. Display names
can change with configuration or localization. The flag may also follow the
name (`tyco-ctl run 'My command' --name`), as in earlier versions.

### Execute and return the result

```sh
tyco-ctl run default:core.correct:fix --stdin --wait < draft.txt > corrected.txt
tyco-ctl run my-backup --wait
tyco-ctl run my-reminder --input-json '{"at":"18:00","message":"Call"}' --wait
```

These commands require individual external grants. A normal `run` is
non-interactive. Missing text returns `InputRequired`. It does not open a
window, capture a selection,
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

Interactive execution may ask for input. It never implicitly
uses a selection. `--selection` captures the focused application's selected
text; without `--replace`, the output is returned and the old clipboard is
restored when the job ends. `--replace` requires `--selection`, overrides configured after-run output handling, and inserts the
result back into the original target. Empty replacement output is a failure.

A changed foreground window prevents insertion: the result remains in the
clipboard, the job fails with `SelectionFailed`, and its output remains
available for recovery. An interactive command launcher is hidden before
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

Client `--timeout` controls waiting (default 300, range 1–3600 seconds); it is
accepted only together with waiting, like `run --json`. A client
wait timeout does not itself cancel the job; use `jobs cancel` explicitly. Local
IPC frames have a 10-second read/write deadline and a 1 MiB limit. Idle clients
do not block the listener; connections are bounded.

### Exit codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| 0    | Request accepted, or successful completion when waiting |
| 2    | Invalid arguments/input, missing input, ambiguous name  |
| 3    | Permission denied or interactive UI required            |
| 4    | Service/command unavailable, disabled, busy, not found  |
| 5    | Execution or other API failure                          |
| 6    | Timeout                                                 |
| 7    | Cancellation                                            |

Use `--wait` when the calling script needs the tool's success or failure.
Machine error codes are stable identifiers separate from human-readable text.

## D-Bus

D-Bus is a shortcut-friendly launcher on Linux: it opens Tyco windows and
starts library commands the way a user would. It has no discovery, background
execution, job monitoring, or quitting; use `tyco-ctl` for those. Both share the
authorization dispatcher, so the same grants and capabilities apply.

| Method              | Arguments          | What it does                                        |
| ------------------- | ------------------ | --------------------------------------------------- |
| `Open`              | `s` mode           | Opens the window of the mode                        |
| `OpenWithText`      | `s` mode, `s` text | Opens it with the text as input                     |
| `OpenWithSelection` | `s` mode           | Opens it with the selection of the focused window   |
| `RunCommand`        | `s` command ID     | Runs the command interactively, applying `afterRun` |
| `ReplaceSelection`  | `s` command ID     | Replaces the selection with the command's output    |

Modes are those of `tyco-ctl open`. `RunCommand` behaves like
`tyco-ctl run <id> --interactive --output configured`: it asks for missing
input in the command launcher. `ReplaceSelection` behaves like
`tyco-ctl run <id> --selection --replace --interactive`. Command IDs are
stable library IDs; display names are not accepted.

```sh
busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface \
  Open s editor

busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface \
  RunCommand s my-backup

busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface \
  ReplaceSelection s default:core.correct:fix
```

Successful calls acknowledge activation; they do not return command results or
wait for completion. A failure is a D-Bus error named after the machine code,
for example `org.tyco.Error.AccessDenied`, `org.tyco.Error.NotFound`, or
`org.tyco.Error.InteractionRequired`; the message is human-readable. Malformed
arguments fail with the standard `org.freedesktop.DBus.Error.InvalidArgs`.

KWin reports use the separate `org.tyco.KwinTracker` interface at the same
object. `KwinWindowActivated`, `KwinWindowClosed`, and `KwinWindowMissing` are
internal methods: they accept only the current owner of `org.kde.KWin`, not
ordinary API clients.
