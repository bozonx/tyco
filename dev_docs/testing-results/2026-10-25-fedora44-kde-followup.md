# Fedora KDE native follow-up (without AppImage acceptance)

This follow-up uses an embedded debug executable built with `--no-bundle` in
`tyco-desktop-smoke:1.64.1-1.98.1`. It loads Fedora's system GTK/WebKitGTK,
unlike the earlier AppImage runs with bundled Ubuntu WebKitGTK. AppImage
installation, upgrade and release package acceptance are excluded by request.
The original LHC base remains read-only; every run uses a disposable Tyco disk.

## Changes

- Voice capture detects missing input callbacks, emits a terminal error and
  drops the stream. Silent PCM still counts as a live device. The removal test
  checks automatic client release before an explicit Stop and starts a fresh
  native recording after device restoration.
- Linux clipboard snapshots retain HTML-only data, with byte-exact native
  paste/restore checks and an assertion that no plain-text type was offered.
- Quick panels select the recipient's monitor on KDE using its independently
  captured window geometry, and fit within small high-DPI output bounds.
  A separate two-output VM exercises mixed DPI, primary changes, left/right
  layouts and output removal while Quick is visible. It verifies actual KScreen
  state before input, native bounds and exact insertion. The same WebView, draft
  and activation survive unplugging the selected output.
- Escape accepts the next press after a hidden WebView loses keyup, including
  WebKit incorrectly marking that press as autorepeat. Native activation resets
  keyboard state; actual repeats within an activation remain suppressed.
  Regression tests reproduce both the stale latch and stale repeat flag.
  Explicit dismissals use `hide_window`; blur requests ignore regained focus
  and monitor relocation. Native input focus is observed before physical keys.
- Native accessibility enumeration tolerates null and disconnected application
  nodes, without treating a missing required control as success.
- The runner's LLM fixture is terminated and reaped. Frontend fixtures provide
  the desktop API and chat scope they actually use, eliminating unrelated
  TypeError/Vue warnings from those passing component tests.
- Empty/whitespace credentials returned by the native vault are unavailable;
  they are not exposed as usable keys or sent in requests.

## Root causes distinguished from application failures

### Q35 repeated sleep

`20261025-171805-7965d4/suspend-diagnostic.json` reproduces the second-sleep
failure **without Tyco running**. QEMU 11.1.1 exposes one actual SUSPEND/WAKEUP
pair; the next guest kernel entry/exit never reaches an observable suspended
QEMU state. Extending the first sleep and reapplying USB wake settings did not
repair Q35. The isolated sleep case therefore uses the i440fx (`pc`) machine,
recorded in `report.json` and `qemu-command.json`; the other cases retain Q35.

`20261025-171004-5de69f` passed three actual S3/QMP wake cycles on i440fx,
with kernel evidence, unchanged boot identity, exact secret reads and physical
hotkey recovery after each wake. This does not certify Q35 repeat-sleep behavior.

### KWallet write durability

`20261025-171529-239db5/secret-diagnostic.json` reproduces the credential loss
using native `secret-tool` and **no Tyco process**:

| Native experiment                               | Before reboot                                        | After reboot                           |
| ----------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| Reboot immediately after store                  | Exact 28-byte value; encrypted wallet still 60 bytes | Item metadata exists, value is empty   |
| Observe encrypted wallet mutation before reboot | Wallet grows to 256 bytes                            | Exact 28-byte value and hash preserved |

KWallet 6.31.0 defers encrypted-file writes. Its upstream implementation
[schedules a sync timer](https://github.com/KDE/kwallet/blob/master/src/runtime/ksecretd/ksecretd.cpp).
The test's independent observations, rather than that source alone, establish
this guest's loss window. No delay or automatic retry is used to turn the
immediate-reboot failure into PASS.

Lifecycle tests now seed an explicitly durable fixture by locking/unlocking
its native collection and checking its exact bytes before the transitions.
They test recovery of existing credentials. They do **not** certify immediate
write durability. Locking a user's shared wallet on every key save would be
an intrusive application workaround and is not implemented.

The upstream immediate-write/reboot defect remains a platform limitation.
Tyco now rejects the empty value on reload, so the UI cannot report it as a
usable credential. The original failed reports remain unchanged.

## Verification and native results

Local verification passed: `pnpm check`, `pnpm test` (2617 desktop UI tests;
all eight workspace tasks), `pnpm test:vm:unit` (30 tests), Python fatal-error
lint and `cargo fmt --check`. Rust clippy with warnings denied and all Rust
tests passed (570 passed, two intentionally ignored) before the final
frontend-only Escape activation fix. The no-bundle build passed.

Artifact `tyco-native-repeat` SHA-256:
`dd73a5394444645ab1edca61468dc119e1f1158bf7b47bbe8d2ae9767d176ad6`.
Source commit: `3c562046ac48f0a3ff2932882d876098ddc7aabc` plus production diff
`d90c979945543d8ec0c0930442d1186762d5329ebab01d69bd1b0f53b3f9ae39`.
The `.build.json` and `.source.diff` artifact sidecars retain build identity.

Targeted run `20261025-200352-a7292b` passed all six checks, including three
real PAM lock/unlock cycles with fresh Escape dismissal after each recovery.

Full native run `20261025-200636-43e308` finished with 51 PASS and two FAIL:
Escape after the second sleep and a WebDriver disconnect during process
restart. Diagnostic run `20261025-202504-4c09ea` proved WebKit marked the next
physical Escape as `repeat=true` after losing the previous keyup. Keyboard
state now resets at a new native activation; autorepeat is suppressed only for
an observed held key in that activation. The regression test includes the
actual stale-repeat event sequence.

Targeted persistence run `20261025-202834-461b67` passed three restarts after
the controller waited for the old native process to exit before creating its
next WebDriver session. Transport failures now retain their method/path in the
report without replaying application actions.
Detailed reports are under `dev_files/vm/fedora44-kde/runs/`; the diagnostic
scripts/logs and build logs remain under `dev_files/vm/`.

Targeted final-binary sleep run `20261025-203134-493f12` passed three actual
S3 cycles and physical Escape dismissal after each recovery.

Final complete run `20261025-203334-bae536` finished with **52 PASS, 1 FAIL**.
Every application/desktop case passed, including three-cycle lock, sleep,
logout and reboot, mixed-DPI/hotplug, HTML-only clipboard and microphone removal.
The remaining failure was the controller's first `POST /timeouts` immediately
after a new WebDriver session; its method/path was captured in
`webdriverReadDisconnects`. Waiting for native process exit alone had not
eliminated this startup transport race.

The controller now observes a usable main window before configuring timeouts.
Only disconnected window-handle observations are polled; startup, configuration,
IPC and user actions are never automatically replayed. A focused regression test
checks readiness precedes configuration. Final targeted run
`20261025-204830-94f7a3` passed all five checks, including three native process
restarts and single-instance checks, using the **same final artifact**.
The complete run's original FAIL remains unchanged; a new complete green suite
has not been claimed from the targeted rerun.

| Final-artifact scope                 | Evidence                             | Result                               |
| ------------------------------------ | ------------------------------------ | ------------------------------------ |
| Complete native suite                | `20261025-203334-bae536/report.json` | 52 PASS, controller persistence FAIL |
| Corrected persistence controller     | `20261025-204830-94f7a3/report.json` | 5 PASS; three restarts               |
| Additional repeat-sleep verification | `20261025-203134-493f12/report.json` | 6 PASS; three real S3 cycles         |

## Remaining acceptance boundaries

- KWallet 6.31.0 immediate-write/reboot value loss is independently reproduced
  without Tyco. Existing durable secrets pass lifecycle recovery, and empty
  values are rejected, but newly saved-key durability remains unresolved.
- Repeated Q35 sleep remains a VM-platform defect; observed repeated sleep is
  certified only on the recorded i440fx fixture.
- AppImage build, packaging and upgrade acceptance were excluded by request.
- Physical GPU, microphone/Bluetooth, sleep and monitor hardware remain outside
  virtual-device evidence. Other OS/desktop profiles are not implemented yet.

The remaining Fedora-specific product acceptance blocker is KWallet immediate
write durability. The implemented native scenarios now have passing evidence
across the complete run and the corrected targeted persistence run. Moving to
other OS profiles can proceed with this dependency limitation explicitly tracked.
