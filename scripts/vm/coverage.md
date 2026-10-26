# Native VM coverage

This table describes implemented assertions, not an automatic PASS for a whole
platform. Actual executions, binary identities and remaining limits belong to the
[latest follow-up report](../../dev_docs/testing-results/2026-10-26-native-acceptance-followup.md).
Historical reports remain unchanged after fixes or new runs.

Fedora uses a read-only LHC base, an immutable Tyco prepared overlay and disposable
run disks. Ubuntu GNOME uses its own read-only Tyco source copy and prepared base.
GNOME never loads the KWin observer or an extension granting Tyco window access.
Tests preserve the real session bus, compositor and portals; guest external egress
is blocked. Software rendering and loaded WebKitGTK libraries are recorded.

## Assertions by platform

| Cases              | Fedora KDE Wayland                                                                                                    | Ubuntu GNOME Wayland                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM-01              | Embedded startup, three process restarts, settings/history, second launch retains one owner                           | Embedded startup, process exit/restart, settings/history and one owner                                                                                          |
| VM-02–03           | Physical shortcuts; replacement/disable, US/RU, native conflict cancellation, portal allow/cancel/revoke              | Physical shortcuts; native portal allow/cancel, actual GNOME reassignment/disable/revoke, US/RU and opening/closing system settings                             |
| VM-04              | Exact Unicode/multiline/long text in Wayland/XWayland receivers, saved Kate document and Firefox textarea             | Enabled UI action delivers exact text to independent Wayland/XWayland receivers and a separate native WebKitGTK browser                                         |
| VM-05              | Inline correction, selected fragment only, CLI, app switching, cancellation, reviewed replacement and empty selection | Quick cancellation leaves foreign text unchanged; granted unsupported selection requests with/without a selection fail without editing or taking focus          |
| VM-06              | Closed target, same-title windows, focus race, actual desktop target rejected                                         | Addressed target identity is unsupported. Capability is explicitly `focusReturn`; these KDE guarantees are not claimed                                          |
| VM-07              | Byte-exact text/HTML-only/PNG restoration, PRIMARY and a newer concurrent clipboard owner                             | No background snapshot on GNOME. Inserted text intentionally remains in the clipboard; focused native receiver observes it, no focus theft, newer copy retained |
| VM-08              | Konsole raw TTY, Ctrl+Shift+V, exact bytes, no Enter, released modifiers                                              | GNOME Terminal raw VTE, exact bytes, no Enter and released modifiers; explicit Ctrl+Shift+V setting because target classification is unavailable                |
| VM-09–10           | Actual daemon/socket/tool/uinput faults, denied portal fallback, recovery; approved RemoteDesktop with ydotool absent | Honest capability/selection degradation; native GNOME RemoteDesktop deny/approve without ydotool and exact portal-only delivery                                 |
| VM-11              | Native tray Show/Quit, fullscreen overlay, 100/150/200% DPI, two outputs/mixed DPI/primary/layout/output removal      | AppIndicator enabled/disabled and native tray callbacks; actual Mutter DPI/layout/primary/output removal with draft and insertion checks                        |
| VM-11.notification | Real failing background command, native desktop notification accessibility tree                                       | Same; native GNOME notification UI, no mock notification service                                                                                                |
| VM-12              | Native KWallet provisioning, exact independent byte hashes, redaction/delete, locked/unavailable store and recovery   | Native GNOME Keyring prompt, independent byte hashes, redaction/delete, canceled unlock, authenticated recovery and actual bus denial                           |
| VM-13              | Real CLI/session D-Bus, selection and command grant/execute/revoke                                                    | Real CLI/session D-Bus, default selection denial and command grant/execute/revoke                                                                               |
| VM-14              | Native GTK picker/cancel, Unicode/spaced plugin install/worker/remove, Dolphin drag/drop and sibling denial           | Native GTK picker/cancel, spaced path, Nautilus/XWayland → Tyco/Wayland drop, exact bytes/attachment and sibling denial                                         |
| VM-15              | Real PipeWire/CPAL nonzero PCM, stop/release, missing server/recovery and device removal                              | Same capture/device boundary with the real GNOME session audio server                                                                                           |
| VM-16              | Three-cycle native PAM lock, logout/login, reboot and observed i440fx S3                                              | Three-cycle native PAM lock, GDM logout/login, reboot and observed i440fx S3; exact existing secret bytes and physical hotkey recovery                          |
| VM-18              | Separate release AppImage installation/offline launch/reinstall/restart/removal; real upgrade needs an older artifact | Production package acceptance is a separate scope; no package PASS from an embedded debug executable                                                            |

The receiver imports no Tyco code. Assertions use foreign process text, raw TTY
bytes, browser loopback observations, native accessibility, session/boot IDs,
QMP suspension events, native keychain hashes and PipeWire clients. Screenshots
supplement these observations. Each backend has one receiver process and a new
PID must publish state before the next test uses it.

QMP chords have a bounded hold and new press/release edges are observed in the
guest kernel after release; this does not replace
checking compositor focus, exact activation counts and received text. Timeouts
fail. Application actions are not automatically replayed. Only explicitly pure
WebDriver observations and idempotent driver context/timeout configuration may be
polled on the same native session; their
transport disconnects are recorded. Isolated cases preserve their own frozen
runner hashes and reports.

## Run levels and work kept outside VMs

- Smoke: three insertion cycles and essential startup/input behavior.
- Native: applicable session matrix, five insertion/activation cycles.
- Stress: native with `--stress`, at least twenty cycles; can target a subsystem.
- Lifecycle: three actual transitions regardless of insertion repetition count.
- Package: separate production installation lifecycle.

Configuration/history CRUD, quoting and authorization combinations, plugin worker
contracts/sandboxing and text transformations stay in unit/browser/native desktop
smoke tests. VM checks keep an integration sample. GNOME's GTK picker and native
drop are tested there; repeating every platform-independent plugin installation
assertion in every desktop is unnecessary.

PCM checks prove actual native capture and device teardown. They do not certify
recognition quality or the entire voice UI/STT workflow. Those state/interaction
combinations belong to model/browser tests and desktop integration; external
speech services are not VM acceptance dependencies.

GNOME native shortcut assignment uses the same per-app settings and portal
`RebindShortcuts` path as GNOME Settings. Physical delivery is the acceptance
assertion. When a disabled shortcut lacks `trigger_description` in GNOME's portal
response, the current ashpd decoder can retain the prior display metadata.
Native settings, physical results and application metadata are recorded separately;
a PASS for revocation does not certify refreshed UI metadata.

## Acceptance boundaries

An OS/dependency/hypervisor defect independently observed outside Tyco is an
external limitation, not a product blocker. Keep its original failure and verify
Tyco's error/degradation behavior. KWallet 6.31.0 immediate-write/reboot loss and
Q35 repeated S3 are such limits. Existing durable credentials and i440fx S3 remain
required checks. No forced wallet locking workaround is added to key saving.

A targeted PASS does not certify a whole suite. The GNOME full runner checks its
required case inventory; missing applicable cases produce BLOCKED. Failed/blocked
checks still cause a nonzero exit. Package upgrade is blocked until a genuinely
older release exists; reinstall is not upgrade. Package and hardware acceptance
do not prevent beginning Windows/X11 work with the functional scope documented.

Virtual devices cannot certify physical GPU drivers, microphone/Bluetooth,
monitor connections or hardware sleep. Other VM profiles remain unimplemented.
