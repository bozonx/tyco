# Fedora KDE: validation of 9d5b3b64

This report supersedes the earlier baseline for source `5f09eb7f`. Subsequent
repository commits changed the backend, including RemoteDesktop input fallback.
The baseline findings cannot be attributed to the newer source without retesting.

Source: `9d5b3b64573c40a1e4ac293bdbfd00299f58480e`. Production source trees are
unchanged from that commit; working-tree changes concern the VM controllers and
documentation. Build sidecars preserve source-diff hashes before and after build.

| Artifact         | SHA-256                                                            |
| ---------------- | ------------------------------------------------------------------ |
| Debug AppImage   | `9143eb0ca1348ff3c3e41e8b6ecb1026c0478df9fb40929397871f7e24180def` |
| Release AppImage | `fef4d2aa520003851d47cbe18cbee901aaa980a1247d0b5838bbf97e4e981d29` |

Both use container image ID
`sha256:2759c4b4604a0ae9526350272ecaca55d82c8b3ce601bb0f2516d68129f059ab`.
The Ubuntu 24.04 image supplies bundled WebKitGTK/JavaScriptCore 2.52.6. The guest
is Fedora 44 Cloud Edition with installed Plasma/KWin 6.7.5, kernel
`6.19.10-300.fc44.x86_64` and SELinux Enforcing. Fedora's system WebKitGTK 2.54.1
is not the bundled AppImage runtime. Software rendering is explicit and recorded.

## Controller corrections

- Native receiver focus uses the independently observed PID/window ID through
  KWin. Repeated short Alt+Tab toggled only two recent windows and could not
  select a third recipient. The check of focus returned by Tyco remains
  independent of this setup step.
- Main-only IPC commands run in the main webview. Capabilities were not weakened.
- Folder selection uses GTK's actual named `show_location` accessibility action
  and an enabled confirmation control; the exact returned home path is checked.
- Dependency-failure tests deny actual KDE Remote Control requests when the new
  RemoteDesktop fallback is offered. A separate positive subcase removes ydotool,
  approves the real dialog and checks exact text/focus plus native sender status.
- Audio checks distinguish application recording clients from the fixture's
  remap-source loopback and preexisting clients. The observed false leak involved
  the loopback surviving until fixture removal; the Tyco client had terminated.
  Two regression tests cover that distinction and detection of a real new leak.

Earlier failed attempts remain in their original reports. They were not rewritten
as PASS. The older baseline full attempt (artifact `51baa204...`) also recorded a WebDriver startup disconnect;
there is no automatic application restart or whole-case retry to conceal it.

## Local verification

`pnpm check`, `pnpm check:rust`, `pnpm test` and `pnpm test:rust` passed on this
source. Desktop UI has 2610 passing tests; all eight workspace test tasks passed.
Rust has 560 passing tests across targets and two intentionally ignored tests
requiring a real system store/headless compositor. The VM runner has 20 passing
focused tests. Ruff formatting/static checks also passed.

## Native results

47 checks, including environment validation: **44 PASS, 3 FAIL**. These are
aggregated completed checks rather than a claim of one uninterrupted full-run
PASS. The host rebooted at 14:23:30, interrupting an earlier parent and logout
child; their original reports remain incomplete and have interruption sidecars.
Unfinished work ran again in fresh VMs. Suspend was also repeated after the host
reboot.

| Completed report         | Scope and result                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261025-141601-b6cfa3` | Actual GlobalShortcuts cancellation PASS                                                                                                                                      |
| `20261025-141647-6377f7` | Three native PAM lock/unlock cycles PASS                                                                                                                                      |
| `20261025-143750-1710ef` | Suspend/resume FAIL, repeated after host reboot                                                                                                                               |
| `20261025-142819-18be06` | All remaining selected native checks: 42 PASS, 2 FAIL; includes three actual logout/login cycles, 20 Wayland + 20 XWayland cycles and the approved/denied RemoteDesktop paths |

The aggregate is `dev_files/vm/current-head-native-summary.json`. It verifies
matching artifact SHA-256, source commit and frozen controller hashes across the
completed native reports, with no duplicate check IDs. Detailed reports are in
`dev_files/vm/fedora44-kde/runs/<report>/report.json`.

| Failed check           | Independent observation                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VM-16.suspend-resume` | First wake recovered native functions; a later attempt did not expose the required QEMU ACPI suspended state before timeout                                          |
| `VM-16.reboot`         | Native KWallet item exists after cold reboot, but independent Secret Service GetSecret returns zero bytes; the initial exact-byte check had passed                   |
| `VM-15.device-removal` | Removing the actual virtual source leaves capture corked on a nonexistent source without error/end or a verified live reroute; explicit stop releases the app client |

These observations do not establish which component causes each failure. Native
journals, QMP events, screenshots, state and retained encrypted fixtures preserve
the evidence. No failure is reassigned to manual acceptance.

## Production package results

Release report `20261025-144613-5f4fca`: **6 PASS, 1 BLOCKED**, including environment
validation. Install/desktop launch, exact offline editor copy through the native
clipboard, same-version reinstall, restart and uninstall all passed without
WebDriver. User data/configuration were retained.

Upgrade is BLOCKED because no suitable older release artifact exists. Consequently
the package command exits nonzero; reinstall is explicitly not counted as upgrade.
The earlier package attempts remain FAIL: one controller copied over a still-busy
AppImage, another treated temporarily absent clipboard MIME data as fatal. The
corrected controller waits for native app/runtime exit, replaces the image
atomically, and polls clipboard publication without repeating the Copy action.

The expected native/package nonzero exits reflect their recorded FAIL/BLOCKED
checks, not an assertion that release acceptance passed.

## Scope and remaining inputs

Only Fedora KDE is prepared. Other OS/desktop profiles, HTML-only clipboard
preservation and virtual multi-monitor topology are not certified. Missing
automation is not reclassified as manual acceptance. Manual work is limited to
physical hardware properties the stand cannot reproduce.

Upgrade requires a genuinely older release AppImage. Repository release inventory
is empty and no suitable local older release is available. Baseline and current
builds both report version 0.1.0, so they cannot masquerade as an upgrade pair.
The implemented upgrade branch remains unverified until that input exists.
