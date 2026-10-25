# Fedora KDE VM automation coverage

The stand uses the original LHC disk read-only, a separate immutable prepared
Tyco overlay, and disposable per-run disks. It never starts an LHC runner or
attaches its cache disk. Fedora 44 KDE Wayland is the only implemented profile;
XWayland recipients are tested inside that session, not a full X11 login.

## Automated observations

A subcase PASS is not acceptance of the entire scenario or platform matrix.
The dated reports in `dev_docs/testing-results/` identify actual executions.

| Cases    | Independent observations                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM-01    | Embedded app startup, settings/history across three process restarts, single instance                                                                                                                               |
| VM-02–04 | Twenty physical QMP activations each for Wayland and XWayland, exact Unicode/multiline/long text, focus, single activation and released modifiers                                                                   |
| VM-02    | Actual shortcut replacement/disable, US/RU layouts, native conflict dialog cancellation without changing either assignment                                                                                          |
| VM-03    | Real KDE portal allow, cancellation and revoked system assignment; cancellation runs in a separate VM                                                                                                               |
| VM-04–05 | Real Kate saved bytes and Firefox textarea; native selection replacement/cancellation, explicit empty-selection error                                                                                               |
| VM-06    | Closed target, two same-title windows and focus race, actual desktop target rejected without editing another window                                                                                                 |
| VM-07    | Plain text and PNG clipboard restoration, preserved PRIMARY, newer concurrent clipboard owner retained                                                                                                              |
| VM-08    | Actual Konsole raw TTY/bracketed paste, exact payload, no synthetic Enter                                                                                                                                           |
| VM-09    | Real daemon stop, socket permissions, absent clipboard/input tools and unavailable uinput; native RemoteDesktop denial/error and recovery; separate approved portal fallback with ydotool absent                    |
| VM-11    | Main-window close hides to native tray; real Show/Quit callbacks; fullscreen overlay; KScreen scales 1/1.5/2 with actual click/clipboard checks                                                                     |
| VM-12    | Native KWallet wizard, independent secret lookup and redaction/deletion; locked and unavailable service errors and recovery                                                                                         |
| VM-13    | Actual CLI/D-Bus, default denial, selection grant/revoke, quoted multiline command grant/execute/revoke                                                                                                             |
| VM-14    | Actual GTK folder selection/cancel, Unicode/spaced plugin picker/install/worker/removal, native Dolphin drag/drop and denied ungranted sibling read                                                                 |
| VM-15    | Actual PipeWire/CPAL nonzero PCM, stop/release, missing server and recovery; microphone removal requires terminal error/end or a verified live reroute                                                              |
| VM-16    | Three-cycle tests for real PAM lock/unlock, logout/login, ACPI sleep/wake and reboot in separate VMs (a failure aborts that cycle sequence); hotkey/tray/history and raw native secret bytes checked after recovery |
| VM-18    | Release AppImage install/offline launch/copy/reinstall/restart/removal without WebDriver; upgrade requires a different real older version                                                                           |

The receiver has no Tyco imports. A separate KWin observer compares native IDs
with the captured insertion target. Native AT-SPI, QMP, process maps, session
journals, CLI, native secret-byte hashes and screenshots provide OS evidence.
Each run freezes and hashes its runner files. Timeouts fail; an unobserved action
never passes. Application actions are not automatically retried. Infrastructure
SSH transport reattachment preserves the app/session and is recorded separately.

## Current failures and limits

Repeated ACPI suspension, native secret contents after cold reboot, and capture
after microphone removal have produced FAIL. These remain automated failures;
they are not moved into manual acceptance. Package upgrade is BLOCKED because no
previous published/local release artifact is available. The upgrade execution
branch is implemented but has not been verified against a real older release.
Any failed or blocked check causes a nonzero suite exit.

The debug AppImage supports WebDriver diagnostics; production package acceptance
uses a separately built release AppImage. Both bundle Ubuntu WebKitGTK; the
Fedora system library version alone does not describe their loaded runtime.

HTML-only clipboard preservation is not covered: the backend snapshots text or
image formats. Virtual multi-monitor topology and other OS/desktop profiles are
not certified by these runs. Their missing automation remains follow-up work,
not a reason to mark them manual or passed.

Manual acceptance is limited to physical properties the stand cannot reproduce:
physical microphone/Bluetooth behavior, GPU/driver behavior, hardware sleep, and
physical monitor connections. VM audio, suspend, DPI, virtual display topology
and native dialogs are automation candidates.
