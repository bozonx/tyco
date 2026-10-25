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
  A separate two-output VM exercises mixed DPI, primary changes, negative
  coordinates and output removal while Quick is visible.
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

Final run results and artifact identity are recorded below after verification.
Detailed reports are under `dev_files/vm/fedora44-kde/runs/`; the diagnostic
scripts/logs and build logs remain under `dev_files/vm/`.
