# Fedora 44 KDE automation: 2026-10-25

This is a historical baseline report. See [current source validation](2026-10-25-fedora44-kde-current-head.md) for later commits.

This is a Fedora KDE automation report, not acceptance of the entire platform
matrix. The original LHC disk is frozen read-only. Each run uses a disposable
Tyco overlay, real unlocked Plasma Wayland, the user's actual session bus,
restricted QEMU networking and an independently checked guest egress firewall.
The guest identifies as Fedora 44 Cloud Edition with installed Plasma/KWin
6.7.5, kernel `6.19.10-300.fc44.x86_64`, portal 1.22.1 and KDE portal 6.7.5;
SELinux is Enforcing. This is not a claim about an untouched official KDE Spin.
No host clipboard or input passthrough, Xvfb, private session bus or manual dialog
interaction is used. Virtual VGA uses explicitly reported software rendering.

## Artifacts and changes

Source commit: `5f09eb7fce05cc36ac0a8d80f5aaa440e401ff6d`, with the task's dirty
working tree recorded in each JSON report. The production changes serialize
KWin tracker D-Bus handlers to preserve report order and conditionally import a
Rust path type used only by debug/tests. The tracker fix passed 20 physical
Wayland and 20 XWayland insertion cycles. Earlier diagnostics are described in
[the smoke report](2026-10-24-fedora44-kde-smoke.md) and
[the native progress report](2026-10-24-fedora44-kde-native.md).

| Build              | AppImage SHA-256                                                   |
| ------------------ | ------------------------------------------------------------------ |
| Baseline debug     | `51baa2049ccf93149b1359a91c463130218e990bf693fafe8e8bf439e0e755dd` |
| Production release | `6017ddb418e8b83f935d8a174816bcbe52bbb124ac3123fba95547e135a25a11` |

Both artifacts were built against the Ubuntu 24.04 container baseline, separately
from the Fedora guest. The AppImages bundle WebKitGTK 2.52.6; Fedora's installed
WebKitGTK 2.54.1 is not evidence of the bundled runtime. Build sidecars and native
process maps identify the actual artifacts and loaded libraries. The debug
artifact supports WebDriver; release package checks use native UI, clipboard,
CLI and tray without WebDriver.

## Recorded observations

Detailed reports are local, ignored artifacts under
`dev_files/vm/fedora44-kde/runs/<run>/report.json`. A passed subcase does not turn
an entire failed run into PASS. The current runner freezes controller sources and records their
hashes. Historical runs must be interpreted using their own artifact hashes and
scope, rather than attributed to the current build.

| Run                      | Observations                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20261024-223137-36d87f` | Smoke PASS: 20 Wayland + 20 XWayland physical hotkeys/insertion, exact Unicode/multiline text, focus and restart persistence; earlier debug build                                                                              |
| `20261025-082840-76a030` | Same-title/focus race, fullscreen overlay, native close-to-tray/Show/Quit PASS                                                                                                                                                 |
| `20261025-083547-51546d` | Desktop target rejection and actual unavailable-wallet error/recovery PASS                                                                                                                                                     |
| `20261025-085345-ab8119` | Actual Dolphin Unicode/spaced file drag/drop PASS; unrelated sibling file read denied                                                                                                                                          |
| `20261025-093414-bce73a` | Actual occupied-shortcut Reassign dialog/Cancel PASS; original assignments retained                                                                                                                                            |
| `20261025-100505-5cff5f` | Three native lock/PAM unlock cycles PASS, with four exact native secret-byte checks                                                                                                                                            |
| `20261025-100838-7635c1` | Three actual logout/login cycles PASS, new session leaders, same boot, recovered hotkey/tray/history/secret bytes                                                                                                              |
| `20261025-100616-aa505f` | Repeated suspend FAIL: first recovery checked, later QMP ACPI suspended state not observed                                                                                                                                     |
| `20261025-101032-b13dd8` | Cold reboot FAIL: native secret item exists but GetSecret returns zero bytes, independently hashed through Gio Secret Service                                                                                                  |
| `20261025-102111-155a72` | Microphone removal FAIL: nonzero PCM before removal, then corked capture on source `4294967295`, no end/error/live reroute; explicit stop releases recording clients. Audio fixture fallback-source restoration also timed out |
| `20261025-103403-a7c848` | Native folder selection PASS: native location field and enabled confirmation, exact `/home/tester` result                                                                                                                      |
| `20261025-102807-f48a64` | Microphone-removal failure reproduced; explicit stop releases clients and configured audio-source policy restored without cleanup errors                                                                                       |
| `20261025-001456-9cfe9b` | Release install/offline native copy/reinstall/restart/uninstall PASS; upgrade BLOCKED                                                                                                                                          |

The folder test selects the actual home directory. Its native accessibility action
is GTK `show_location`, followed by the enabled confirmation control; the earlier
controller label "Home place" was inaccurate. The action is described by the
[GTK implementation](https://github.com/GNOME/gtk/blob/gtk-3-24/gtk/a11y/gtkfilechooserwidgetaccessible.c). Arbitrary typed Unicode-folder
navigation was not certified; plugin file selection and native file drop cover
Unicode/spaced paths separately.

Native secret persistence is checked through actual Secret Service `GetSecret`
bytes, not secret-tool text/binary formatting or the app's availability flag.
The reboot observation does not yet identify whether the defect belongs to the
app, the installed KWallet version or their interaction. Failed encrypted
fixtures and guest diagnostics are retained for investigation.

The remaining automatic scenarios include native Kate/Firefox/Konsole, selection
replace/cancel and grant/revoke, clipboard text/PNG/PRIMARY/new ownership,
missing input dependencies and recovery, portal cancellation/revocation,
US/RU layouts, native folder/plugin pickers, real CPAL start/stop and unavailable
server recovery, and KScreen scale 1/1.5/2. Their individual earlier results are
listed in the progress report and run JSON files; they do not certify other
operating systems or physical hardware.

## Verification and acceptance limits

The runner's 18 focused tests pass, including frozen snapshots, resource locks,
real subprocess cleanup after an SSH master timeout, W3C/application error
separation, embedded JavaScript parsing, isolation selection and actual version
ordering. `pnpm check` passed; Rust formatting/clippy with warnings denied passed,
as did 12 tracker and two storage-path tests. These are the commands actually
run, not a claim that `pnpm validate:all` passed.

Upgrade execution requires a genuinely older AppImage via `--previous-artifact`.
There is no previous published release in the queried repository and no suitable
local older artifact. Equal versions, identical hashes and downgrades are
rejected. The upgrade execution branch remains unverified until that input is
available; reinstalling 0.1.0 does not count as migration coverage.

Only Fedora KDE is prepared. Windows, Debian KDE/Xfce, GNOME and the wider matrix
remain separate automation work. HTML-only clipboard restoration and virtual
multi-monitor topology are not certified. Manual work is reserved for physical
properties the stand cannot reproduce: actual microphone/Bluetooth hardware,
GPU/driver behavior, hardware sleep and physical display connections. Missing
automation and observed failures are never relabeled as manual success.
