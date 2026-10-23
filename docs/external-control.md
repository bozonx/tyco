# External control: CLI and D-Bus

Tyco exposes a deliberately limited API for local desktop integration. It does
not expose arbitrary Tauri functions, secret management, plugin installation,
or configuration writes. The CLI and D-Bus share one Rust authorization and
execution dispatcher. The current external API version is 2; version 2 removes
the shutdown request and adds job listing.

## Prerequisites and transports

Tyco must already be running. Install `tyco-ctl` in `PATH` (on Windows,
`tyco-ctl.exe`). Build the client with:

```sh
cargo build --manifest-path src-tauri/Cargo.toml -p tyco-ctl --release
```

The binary is written to `src-tauri/target/release/tyco-ctl` (with `.exe` on
Windows), unless Cargo's target directory is overridden. Building does not
install it in `PATH`. To build and install the client in Cargo's binary directory:

```sh
cargo install --path src-tauri/tyco-ctl --locked
```

There is no TCP listener and no network fallback. Application shutdown is not
part of the external API: neither CLI nor raw local IPC accepts `quit`. Use the
application's own Quit action to exit.

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

The chooser opens on its first page. A page of its own opens with
`tyco --mode=commandLauncher:<page id>`; Settings → Hotkeys shows that line for
each page, and the hotkey of a page is stored on the page itself
(`launcherPages[].hotkey`).

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
Executing an external library command requires that command's individual
grant; there is no global command-execution grant. Supplied text is visible in process
arguments; use `tyco-ctl run --stdin` for private scripted input.

## Permissions

Each library command is allowed on its own: the terminal icon in its row in
Settings → Commands, or **Available from outside** in its settings. The command
must also be enabled. A newly created command is not granted external access.

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

```json
{ "externalAccess": { "canAccessSelection": false } }
```

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
              [--replace] [--interactive]
              [--wait] [--json] [--timeout SECONDS]
 tyco-ctl replace correction
 tyco-ctl jobs list [--json]
 tyco-ctl jobs <status|cancel|wait> <job-id> [--json] [--timeout SECONDS]
```

`--help` and `--version` work without a running Tyco instance.

`status` prints a JSON object with `apiVersion`, the app `version`, and the
`externalAccess` capabilities that are currently allowed.

Choose the command by the result you need:

| Need                                                  | Command                      |
| ----------------------------------------------------- | ---------------------------- |
| Check whether Tyco is reachable                       | `status`                     |
| Open a visible Tyco window                            | `open`                       |
| Find callable library command IDs                     | `commands list`              |
| Inspect a command's accepted input                    | `commands describe`          |
| Execute a library command and obtain its output       | `run ... --wait`             |
| Submit work and collect the result later              | `run`, then `jobs wait`      |
| Find retained invocations                             | `jobs list`                  |
| Inspect or cancel a submitted invocation              | `jobs status`, `jobs cancel` |
| Correct the current selection from a desktop shortcut | `replace correction`         |

`open` and `replace correction` return no stdout on success. They
acknowledge a request, rather than return a job or wait for the operation to
finish. `status`, descriptions, and non-waiting job operations return JSON.
Errors go to stderr as `Code: message`. Every request accepts `--json`; with
it errors are JSON objects on stderr with `success: false`, `code`, and `error`. Successful
responses without a result still produce no stdout. JSON output never mixes
errors into stdout. For example:

```sh
tyco-ctl commands describe my-fix --json
tyco-ctl run my-fix --stdin --wait --json < draft.txt
```

Use `--help` / `-h` at any command level, without a running Tyco instance:

```sh
tyco-ctl run --help
tyco-ctl commands describe --help
tyco-ctl jobs wait --help
```

### Open the UI

```sh
tyco-ctl open editor
tyco-ctl open settings
tyco-ctl open chat --text 'Explain this paragraph'
tyco-ctl open editor --selection
```

Modes: `editor`, `write`, `chat`, `voice-chat`, `voice-commands`, `voice`, `select`, `ai-tasks`,
`command-launcher`, `correction`, `translate`, `history`, `settings`.
The old camelCase spellings and `config` remain valid aliases.

Opening UI does not implicitly capture a selection. `--selection` captures
before opening the window and requires the selection permission. It restores
the clipboard after capture. Later changes to clipboard content are preserved.

### Discover commands

```sh
tyco-ctl commands list --json
tyco-ctl commands describe my-fix
tyco-ctl commands describe --name 'My command'
```

`commands list` prints one `id<TAB>name` line per command; `--json` prints the
full list instead. Descriptions are always JSON. The list includes the commands
that are currently callable, with `id`, `name`, `input`,
`canReplaceSelection`, and `output` (`"return"`). A structured input is marked `structured`; a description also
includes `textAccepted` and the tool's `inputSchema` when the catalog provides
one. Command-specific schema overrides are validated by the executing tool
registry. Disabled, denied, missing, or unavailable commands return a coded
error when described.

`commands describe` inspects a command; it does not execute it. Use it before
writing a script to determine whether to send text, a JSON object, or no input.
For example, a text command description can look like:

```json
{
  "id": "my-fix",
  "name": "My fix",
  "input": "text",
  "textAccepted": true,
  "canReplaceSelection": true,
  "output": "return",
  "inputSchema": null
}
```

- `input: "none"`: omit input flags.
- `input: "text"`: use `--text`, `--stdin`, or an explicit selection.
- `input: "structured"`: use `--input-json` with an object matching the tool's
  schema. Text is also accepted when `textAccepted` is true (LLM argument
  parsing is enabled). Selection input is not supported for structured commands.
- `canReplaceSelection` describes command compatibility, not the current
  selection permission or platform support.
- `output: "return"` means external runs return tool output instead of applying
  the library command's configured `afterRun` action.
- `inputSchema` is the effective schema after command-specific overrides,
  presets, and plugin defaults, or `null` when no schema has been published.
  It is the schema used by the tool registry to validate explicit JSON input.
  While updated command settings are waiting for catalog synchronization,
  discovery/execution can return `NotReady`; retry after synchronization.

An empty list does not prove the library is empty: commands without grants,
disabled commands, and unavailable tools are omitted. During startup the tool
catalog may still be loading; execution can return `NotReady` even when a
backend-known script or webhook appears in the list.

Use stable IDs in scripts. Without `--name` the target is only ever an ID.
`--name` explicitly selects a display name, ignoring case and redundant
whitespace; an ambiguous name is rejected with `AmbiguousName`. Display names
can change with configuration or localization.

### Execute and return the result

```sh
tyco-ctl run my-fix --stdin --wait < draft.txt > corrected.txt
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

Tool content is always returned in the job's `output`. `--wait` writes that
content to stdout exactly, without adding a newline. `--wait --json` instead
prints the complete final job object. A tool can have its own intrinsic side
effects (for example a webhook, script, `core.copy`, or `core.insert`); choosing
returned output does not undo or disable those effects.

### Interactive execution and selection

```sh
tyco-ctl run my-command --interactive --wait
tyco-ctl run my-fix --selection --replace --interactive --wait
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

`tyco-ctl replace correction` corrects the selection in place, as the inline
correction hotkey does, without a command of the library. It is meant for a
desktop shortcut: the capture starts after a short delay, once the keys of that
shortcut are released, and the call returns without waiting for the result.
While the selection permission is off it fails with `AccessDenied`.

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
tyco-ctl jobs list
tyco-ctl jobs status job-1234-1
tyco-ctl jobs wait job-1234-1 --timeout 60 --json
tyco-ctl jobs cancel job-1234-1
```

A job is one invocation of a library command, not the command definition, an
OS process, or a scheduled task. Two runs of the same command have different
job IDs. Jobs are created by `run` (and the corresponding D-Bus library command
calls), not by `open` or `replace correction`.

| Operation             | stdout                                                | Exit status                                   |
| --------------------- | ----------------------------------------------------- | --------------------------------------------- |
| `jobs status ID`      | Current job JSON, including any retained output/error | 0 if found, even if the job failed            |
| `jobs cancel ID`      | Job JSON after the cancellation request               | 0 if found, including an already terminal job |
| `jobs wait ID`        | Successful output, with no added newline              | The job's completion code                     |
| `jobs wait ID --json` | Full terminal job JSON, also on failure/cancellation  | The job's completion code                     |

`jobs status` and `jobs cancel` always return JSON on stdout; `--json` also
selects JSON errors on stderr. `--timeout` is only valid for `jobs wait`.
`jobs wait` polls the server; it neither reruns nor claims the command.
`jobs list` returns a JSON array of all retained jobs, newest submissions first.
Each entry contains `id`, `commandId`, and `state`; output and error details
are omitted to keep the response small. Use `jobs status ID` for the full job.
An empty array means no jobs are retained. This includes calls from other local
clients within the same session; there is no per-client ownership.

Keep the ID returned by submission when a script needs its own result. For
example, with the optional external `jq` utility:

```sh
job_id=$(tyco-ctl run my-fix --stdin < draft.txt | jq -er '.id')
tyco-ctl jobs status "$job_id"
tyco-ctl jobs wait "$job_id" --timeout 60 > corrected.txt
# If waiting times out, explicitly cancel if the result is no longer needed:
# tyco-ctl jobs cancel "$job_id"
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
accepted only together with waiting. A client
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
execution, or job monitoring; use `tyco-ctl` for those. Both share the
authorization dispatcher, so the same grants and capabilities apply.

| Method              | Arguments          | What it does                                      |
| ------------------- | ------------------ | ------------------------------------------------- |
| `Open`              | `s` mode           | Opens the window of the mode                      |
| `OpenWithText`      | `s` mode, `s` text | Opens it with the text as input                   |
| `OpenWithSelection` | `s` mode           | Opens it with the selection of the focused window |
| `RunCommand`        | `s` command ID     | Runs the command interactively                    |
| `ReplaceSelection`  | `s` command ID     | Replaces the selection with the command's output  |
| `CorrectSelection`  |                    | Corrects the selection in place                   |

Modes are those of `tyco-ctl open`. `RunCommand` behaves like
`tyco-ctl run <id> --interactive`: it asks for missing input in the command
launcher. `ReplaceSelection` behaves like
`tyco-ctl run <id> --selection --replace --interactive`, and
`CorrectSelection` like `tyco-ctl replace correction`. Command IDs are
stable library IDs; display names are not accepted.

```sh
busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface \
  Open s editor

busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface \
  RunCommand s my-backup

busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface \
  ReplaceSelection s my-fix
```

Successful calls acknowledge activation; they do not return command results or
wait for completion. A failure is a D-Bus error named after the machine code,
for example `org.tyco.Error.AccessDenied`, `org.tyco.Error.NotFound`, or
`org.tyco.Error.Disabled`; the message is human-readable. Malformed
arguments fail with the standard `org.freedesktop.DBus.Error.InvalidArgs`.

KWin reports use the separate `org.tyco.KwinTracker` interface at the same
object. `KwinWindowActivated`, `KwinWindowClosed`, and `KwinWindowMissing` are
internal methods: they accept only the current owner of `org.kde.KWin`, not
ordinary API clients.
