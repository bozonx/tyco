# Plan: visible, sequential command runs

Every library command runs in the quick window's command-run overlay, whatever
started it: `tyco-ctl run`, D-Bus `RunCommand`/`ReplaceSelection`, a hotkey
(custom action slot), the action menu. There are no background command runs.
Selection capture/replacement, `replace correction`, trackers and warmup stay
background services. No compatibility with the previous API is kept.

## Rules

- One command runs at a time. A run request while another runs is rejected
  with `Busy` and a toast in the running overlay ("X not started: Y is
  running"). No queue.
- A run counts as running until its job is terminal (including a pending
  selection replacement). A shown result is a finished run: a new run closes
  it and starts.
- Any external request (run, open of an overlay, the main window) ends what is
  visible first, gracefully: voice dictation and the dialog stop recording,
  their results are saved to history, then the requested window/overlay opens
  or the command starts. Hidden-window state of the main window (editor, chat)
  is kept; only visible processes end.
- The overlay takes the keyboard (accepted trade-off). Esc/close cancels the
  run explicitly.
- Before replacing a selection the overlay hides and focus returns to the
  target window; a changed target still fails with `SelectionFailed`.
- Quick-window blur auto-hide neither hides nor cancels a running command.

## Backend (`src-tauri`)

1. `ActivationMode::CommandRun`, internal (not in `PUBLIC_MODES`);
   `ExternalAccess` is removed, its prompt becomes a step of `CommandRun`.
2. `ExternalJobs`: one active job; reserve the slot atomically at the start
   of `start`, before selection capture. Release on terminal state; a webview
   reload/dispose fails the job.
3. `hand_off` activates `CommandRun` through `runtime::activate` instead of
   emitting to a hidden window. `InputRequired` for text commands is gone:
   the overlay asks for the text.
4. A graceful "end visible work" step in the activation coordinator, used by
   every external activation: stop voice/dialog capture, wait for their
   history save (bounded), then switch mode / show the main window.
5. Internal runs (hotkeys, action menu) take the same slot through a new
   command, so internal and external runs exclude each other.
6. Protocol: `API_VERSION` 3, remove `--interactive` and `interactive`;
   rename `externalTimeoutSec` / "Background run limit" to a run limit
   (`runTimeoutSec`) without migration.
7. Status bubble stays only for `replace correction` and selection hotkeys.

## Frontend (`apps/desktop-ui`)

1. `lib/commands/command-run-session.ts`: state machine
   `access → input → running → result | failed | cancelled`, injected deps,
   unit tests. Replaces `external-run.ts` (no status bubble, no notifications).
2. Thin store; `views/CommandRunView.vue` + a layer in `QuickOverlay.vue`;
   rejected-run toast in it.
3. Custom action slots and the action menu start commands through the
   session instead of running them with the window hidden.
4. Voice and dialog expose a graceful stop that resolves after the history
   save; the main window answers the "end visible work" request.

## Docs and checks

`docs/external-control.md` (jobs, interactive, D-Bus, limits),
`dev_docs/architecture.md`, `dev_docs/ui-system.md`; i18n in all locales,
remove unused `externalCommand.*`; `pnpm generate:desktop`, `pnpm check`,
`pnpm test`, `pnpm check:rust`, `pnpm test:rust`.

## Order

1. Rust slot + `CommandRun` mode + protocol v3.
2. Session model + overlay view; external runs through it.
3. Hotkeys and action menu through the session.
4. Graceful ending of voice/dialog/main window on external requests.
5. Docs, i18n cleanup, full validation.
