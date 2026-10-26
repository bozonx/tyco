# Fedora KDE and Ubuntu GNOME native follow-up

Date: 2026-10-26. Functional native testing is separate from production package,
upgrade and physical hardware acceptance. Final suite summaries are recorded below;
individual PASS observations do not automatically certify an entire platform.

## Binary and scope

Embedded debug executable, built with `build-appimage.py --no-bundle` against the
Ubuntu container baseline. This is not AppImage/installer acceptance.

- Executable SHA-256: `b5e26072958d730fa3bce98a0b100f0fb422679c26efe07647eb878a4add142d`.
- CLI SHA-256: `31b5d760953b1b4acd937302420cd32fc7d652f5e76cb8787e6fb9cfb009123b`.
- Build base: `0a5b86d80dc358f161b93e980259ed57f577cd3d` plus the notification-service
  production diff retained in `tyco-audit-notifications.source.diff` and the build
  provenance sidecar. Per-run source identities and frozen controller hashes are
  retained separately. Later test-controller edits do not change a running snapshot.
- Local artifacts: `dev_files/vm/artifacts/tyco-audit-notifications` and
  `tyco-ctl-audit-current`; detailed reports under each stand's `runs/` directory.
- Fedora stand: `dev_files/vm/fedora44-kde-audit`; Ubuntu stand:
  `dev_files/vm/ubuntu2604-gnome-v2`. Source images remain read-only. External guest
  egress is blocked and tested; fixtures use only the guest loopback/session bus.

## Product changes and actual observations

GNOME UI insertion now uses the backend's `focusReturn` capability instead of
requiring `windowId`. The read-only insertion-status command is available to both
trusted windows; key management and other main-only commands remain restricted.
Tracked desktops without a target still have insertion disabled.

Linux regular-window presentation uses GTK directly on the UI thread. Tao queues
show requests and can skip its focus request while GTK still reports the window
hidden. Native repeated activation/focus checks cover the resulting behavior.

The new notification check found that the former per-call D-Bus connection closed
immediately after `Notify`. GNOME independently emitted `NotificationClosed` and
the notification did not remain usable. The sender is now retained by an
application-owned service, has a bounded native-call timeout, rejects new sends
on shutdown, and shares the shutdown deadline. Failed sends are not automatically
replayed. Unit tests cover retention, reconnect on a later request, and shutdown
while a send is in progress. Native notification assertions require the marker in
GNOME Shell/Plasma's accessibility tree, not in a Tyco overlay or IPC result.

## Completed targeted evidence

| Run                             | Scope                                                                   | Observed result                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Fedora `20261026-143519-9727c0` | Native background failure notification                                  | PASS, actual Plasma notification observed                                                                      |
| GNOME `20261026-144248-93e1b2`  | UI insertion, notification, replacement/disable/revoke, US/RU, terminal | Seven checks including environment PASS; exact foreign text/focus and physical keys                            |
| GNOME `20261026-144534-1b4b9f`  | Lock/unlock                                                             | Three real PAM unlock cycles PASS, exact existing credential bytes and hotkey recovery                         |
| GNOME `20261026-145032-711c65`  | Suspend/resume                                                          | Three actual i440fx S3/QMP wake cycles PASS; unchanged boot identity and recovery                              |
| GNOME `20261026-145350-a7e771`  | Reboot                                                                  | Three actual reboots PASS; new boot IDs, exact existing credentials and physical shortcuts                     |
| GNOME `20261026-150004-490121`  | Display topology                                                        | PASS: actual Mutter 100/150/200% state, two outputs, primary/layout changes, output removal and retained draft |

Browser insertion, native GTK picker/cancellation, AppIndicator absence/recovery,
GNOME Keyring locked/unavailable recovery and audio-device checks also have targeted
results; the final suite inventories below determine the complete acceptance scope.
The browser fixture is a separate native WebKitGTK process, not Firefox and not
Tyco's DOM. GNOME Terminal requires an explicitly configured paste shortcut because
GNOME cannot classify arbitrary focused applications.

## Controller corrections

- Logout waits for a new native Wayland session on seat0, not merely a changed
  `loginctl Display`: a short-lived SSH session can occupy that field while GDM
  is starting the graphical session. A new GNOME Shell PID is required; unique bus names can repeat after a user-bus restart.
- S3 disables automatic screen locking explicitly and observes the unlocked
  session after wake. Native lock/PAM remains a separate three-cycle assertion.
- Nautilus DND reads GTK client extents through `xprop` and preserves the exact
  native granted-by-drop and sibling-denial assertions.
- Receiver startup waits for compositor focus. An immediate state read followed
  by Alt+Tab could race native mapping and switch away from an already focused
  receiver; this fallback was removed rather than repeating application input.
- One receiver per backend, verified new PID/state. Earlier duplicate receivers
  could overwrite a shared JSON state file and report another window's focus/text.
- Initial GNOME shortcut status can wait behind the unanswered native binding
  dialog. The controller answers the actual dialog independently of that pending
  read, then observes registration; it does not replay the application operation.
- GNOME settings changes persist the native per-app definitions and call the same
  portal `RebindShortcuts` method used by the desktop settings integration.
- QMP chords have a bounded hold. New guest-kernel press/release sequence numbers
  are observed afterwards, so SSH/observer latency cannot extend a key hold or
  create autorepeat. A missing edge fails and all injected keys are released.
- WebDriver may disconnect during startup reads, automation context selection or
  idempotent timeout configuration. Only those operations are polled on the same
  app/session and each disconnect is recorded. Process startup, IPC, clicks and
  user input are not automatically replayed.
- GDM recovery waits for a new graphical session and a changed GNOME Shell bus
  owner; a closing old session is not a recovered login. Native lock authentication
  remains password/PAM based. GDM timed login is an explicit disposable fixture.

Original failed/incomplete reports remain unchanged. In particular Fedora
`20261026-143646-7d3d50` has 53 PASS and one input-observer failure on dialog
cancellation; it is not relabeled a green full suite. Earlier controller/preparation
failures are retained and do not count as additional product defects.

## External limits and next platforms

KWallet 6.31.0 immediate-write/reboot loss and repeated Q35 S3 failure were reproduced
without Tyco in the earlier follow-up. They are external limitations, not product
blockers. Existing durable secrets and the observed i440fx sleep path remain tested.

GNOME's portal omits `trigger_description` for a disabled shortcut. The current
ashpd decoder can then retain the previous display metadata. The native response,
actual settings, physical inactivity and successful reassignment are distinct
observations; revocation PASS does not claim refreshed UI metadata. This dependency
limit is tracked separately from functional keyboard delivery.

GNOME has no arbitrary foreign-window tracker. Addressed insertion, target-class
terminal detection and clipboard restoration are not certified there. The tested
capability is focus return with clipboard delivery and explicit unsupported-selection
handling. No LHC extension expands these capabilities.

Package upgrade still requires a real older release artifact. Current-version
reinstall is not upgrade. Physical GPU, microphone/Bluetooth, monitor connections
and hardware sleep remain outside virtual-device evidence. These separate scopes
do not require delaying Windows 11/X11 test development.

## Final suite summaries

Fedora KDE full native run `20261026-152225-f981da`: **54 PASS, zero FAIL or
BLOCKED** with the executable identified above. This includes the isolated native
cancel, multi-monitor and four lifecycle checks. Original failing controller runs
remain preserved; this is a separate complete successful run.

Fedora stress run `20261026-194134-358526`: PASS, twenty physical
hotkey/insertion/focus cycles per Wayland and XWayland backend, Unicode/multiline/
long text, with released modifiers. GNOME native drop targeted run
`20261026-194013-5f6837` passed its file-drop assertion; the containing run remained
FAIL due to the separate logout controller race.

GNOME full native run `20261026-200236-70ec78`: **35 PASS, one FAIL**.
All 35 required functional case IDs were executed. The failure is
`VM-16.logout-login`: the second cycle reached a new real Wayland session but
physical pointer confirmation of the native keyring prompt did not activate
Unlock. The original timeout, prompt screenshot and successful first-cycle
secret/hotkey observations remain preserved. This full run is not relabeled PASS.
The controller now verifies focus on the native password entry and confirms with
one physical Return, keeping real authentication.

Corrected logout run `20261026-201355-94cbb9`: **PASS, all three cycles**.
Each cycle terminated a real graphical session, observed a new Wayland seat0
session and GNOME Shell PID on the same boot, authenticated the native keyring
prompt, checked exact existing secret bytes, settings/history and physical hotkey
recovery. Together with the full native run above, every one of the 35 required
GNOME functional case IDs has a passing observation on the identified binary.
This is acceptance by the listed full run plus the corrected isolated rerun, not
a claim that the original full run was green.

GNOME insertion stress `20261026-201355-92b105`: the insertion assertion
passed twenty enabled UI Insert actions per Wayland/XWayland receiver, exact text
and focus. The containing run remains FAIL because its separate hotkey stress
assertion timed out after five cycles; that failure is preserved.

GNOME hotkey stress `20261026-202159-9af7ea`: **PASS, twenty cycles**.
The controller uses one physical non-editing Shift probe after activation and
observes WebKit's released modifier state before testing plain Escape. WebKitGTK's
keyup modifier flags include the key being released; the observation excludes only
that released key and still checks every other modifier. A probe is needed when
the portal-consumed shortcut release precedes Quick focus and delivers no key-up
to that webview. Earlier no-probe and incorrect-observer runs remain FAIL; they
are not relabeled. This test certifies ordinary Escape after observed modifier
release, not arbitrary zero-gap modifier chords. No IPC or failed application
action is replayed.

No unresolved Tyco functional defect was observed in this native acceptance scope.
Windows 11 and other desktop/session VM work can proceed. Package upgrade and
physical hardware evidence remain separate; external OS/dependency defects do
not reopen functional platform acceptance.

Verification after the production notification change: `pnpm check` passed;
`pnpm test` passed (2693
frontend tests and all eight workspace tasks); `pnpm test:rust` passed (588 tests,
two ignored); `pnpm check:rust` passed. The VM controller's standalone regression
suite passed all 35 tests without a VM.
