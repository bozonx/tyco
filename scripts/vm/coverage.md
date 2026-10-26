# Fedora KDE VM automation coverage

The stand uses the original LHC disk read-only, a separate immutable prepared
Tyco overlay, and disposable per-run disks. It never starts an LHC runner or
attaches its cache disk. Fedora 44 KDE Wayland is the main profile;
XWayland recipients are tested inside that session, not a full X11 login.

## Automated observations

A subcase PASS is not acceptance of the entire scenario or platform matrix.
The dated reports in `dev_docs/testing-results/` identify actual executions.

| Cases    | Independent observations                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM-01    | Embedded app startup, settings/history across three process restarts, single instance                                                                                                                                                                                           |
| VM-02–04 | Twenty physical QMP activations each for Wayland and XWayland, exact Unicode/multiline/long text, focus, single activation and released modifiers                                                                                                                               |
| VM-02    | Actual shortcut replacement/disable, US/RU layouts, native conflict dialog cancellation without changing either assignment                                                                                                                                                      |
| VM-03    | Real KDE portal allow, cancellation and revoked system assignment; cancellation runs in a separate VM                                                                                                                                                                           |
| VM-04–05 | Real Kate saved bytes and Firefox textarea; native selection replacement/cancellation, explicit empty-selection error                                                                                                                                                           |
| VM-05    | Inline correction without a Tyco window: physical hotkey in Wayland and XWayland GTK windows, `tyco-ctl replace correction`, three corrections across both window kinds, repeat press cancels; loopback model gets exactly the selected fragment, focus and user clipboard kept |
| VM-06    | Closed target, two same-title windows and focus race, actual desktop target rejected without editing another window                                                                                                                                                             |
| VM-07    | Plain text, HTML-only and PNG clipboard restoration, preserved PRIMARY, newer concurrent clipboard owner retained                                                                                                                                                               |
| VM-08    | Actual Konsole raw TTY/bracketed paste, exact payload, no synthetic Enter                                                                                                                                                                                                       |
| VM-09    | Real daemon stop, socket permissions, absent clipboard/input tools and unavailable uinput; native RemoteDesktop denial/error and recovery; separate approved portal fallback with ydotool absent                                                                                |
| VM-11    | Main-window close hides to native tray; real Show/Quit callbacks; fullscreen overlay; KScreen scales 1/1.5/2 with actual click/clipboard checks; separate two-output mixed-DPI/primary/left-right/hotplug checks                                                                |
| VM-12    | Native KWallet wizard, independent secret lookup and redaction/deletion; locked and unavailable service errors and recovery                                                                                                                                                     |
| VM-13    | Actual CLI/D-Bus, default denial, selection grant/revoke, quoted multiline command grant/execute/revoke                                                                                                                                                                         |
| VM-14    | Actual GTK folder selection/cancel, Unicode/spaced plugin picker/install/worker/removal, native Dolphin drag/drop and denied ungranted sibling read                                                                                                                             |
| VM-15    | Actual PipeWire/CPAL nonzero PCM, stop/release, missing server and recovery; microphone removal requires terminal error/end or a verified live reroute                                                                                                                          |
| VM-16    | Three-cycle tests for real PAM lock/unlock, logout/login, ACPI sleep/wake and reboot in separate VMs (a failure aborts that cycle sequence); hotkey/tray/history and raw native secret bytes checked after recovery                                                             |
| VM-18    | Release AppImage install/offline launch/copy/reinstall/restart/removal without WebDriver; upgrade requires a different real older version                                                                                                                                       |

The receiver has no Tyco imports. Inline correction uses `llm-stub.py`, a deterministic
OpenAI-compatible endpoint on the guest loopback where the default Ollama provider points. A separate KWin observer compares native IDs
with the captured insertion target. Native AT-SPI, QMP, process maps, session
journals, CLI, native secret-byte hashes and screenshots provide OS evidence.
Each run freezes and hashes its runner files. Timeouts fail; an unobserved action
never passes. Application actions are not automatically retried. Infrastructure
SSH transport reattachment preserves the app/session and is recorded separately.

## Current failures and limits

The historical baseline failed repeated ACPI suspension, native secret contents
after cold reboot and capture after microphone removal. Original reports remain
unchanged. The follow-up fixes stalled capture and uses i440fx for observed
repeated sleep, since Q35 fails independently without Tyco. KWallet immediate
write/reboot durability remains a reproduced native dependency defect; lifecycle
tests explicitly checkpoint existing durable credentials before transitions. Package upgrade is BLOCKED because no
previous published/local release artifact is available. The upgrade execution
branch is implemented but has not been verified against a real older release.
Any failed or blocked check causes a nonzero suite exit.

The debug AppImage supports WebDriver diagnostics; production package acceptance
uses a separately built release AppImage. Both bundle Ubuntu WebKitGTK; the
Fedora system library version alone does not describe their loaded runtime.

The native executable follow-up adds HTML-only clipboard and virtual
multi-monitor checks, including exact inserted bytes and draft preservation
after output removal. See the [follow-up report](../../dev_docs/testing-results/2026-10-25-fedora44-kde-followup.md)
for executed results and artifact identity. Initial Ubuntu GNOME coverage is described below; other OS/desktop profiles
remain unimplemented. AppImage acceptance is excluded from that follow-up.

Manual acceptance is limited to physical properties the stand cannot reproduce:
physical microphone/Bluetooth behavior, GPU/driver behavior, hardware sleep, and
physical monitor connections. VM audio, suspend, DPI, virtual display topology
and native dialogs are automation candidates.

## Initial Ubuntu GNOME coverage

The GNOME runner uses its own session check, Ubuntu preparation recipe and
scenarios. It never loads a KWin observer or enables an LHC Shell extension.
It checks native GlobalShortcuts approval and physical activation/dismissal,
process persistence, CLI/D-Bus/default selection denial, command grant and
revocation, GNOME Keyring and real PCM capture/recovery/device removal.

`VM-10.insertion` requires an enabled UI insertion action and exact receiver
contents. `VM-10.backend-insertion` is a separate diagnostic: it explicitly
invokes the native paste command from the quick webview and independently checks
text/focus under Wayland and XWayland. It does not pass the disabled UI action.
The receiver wraps long lines to avoid GTK/Cairo surface-size limits.

GlobalShortcuts repetition observes the native quick-window focus, focused
textarea, exact activation increments, foreign focus on dismissal and released
modifiers. DOM focus alone is insufficient to establish compositor focus.
GNOME Keyring creation retains the D-Bus connection that owns its native prompt;
collection passwords are entered through native controls. Detailed results,
including failed preliminary runs, are in the [GNOME report](../../dev_docs/testing-results/2026-10-26-ubuntu2604-gnome.md).

GNOME RemoteDesktop approval/denial without ydotool, selection replacement
failure behavior, browser and terminal recipients, clipboard restoration,
tray callbacks, dialogs/drag/drop, display topology, session lifecycle and
production package acceptance remain unverified. These gaps prevent full native
platform acceptance. Unsupported package/lifecycle suites do not run KDE code.


## Acceptance policy and run levels (2026-10-26)

External OS/dependency/hypervisor defects independently reproduced without Tyco
are recorded limitations, not product blockers. Original FAIL reports remain
unchanged. Tyco must still handle the unavailable capability/credential correctly.
Functional acceptance, production packaging/upgrades and physical hardware
validation are separate scopes.

Smoke defaults to three physical insertion cycles; native to five; `--stress`
requires at least twenty. Lifecycle cases retain three real transitions. Detailed
configuration/history CRUD, quoting/authorization and plugin sandbox matrices
belong to lower-level suites; native integration smoke remains in each VM.
GNOME backend insertion is an explicitly selected diagnostic, not a second default
copy of the UI insertion matrix.

The follow-up runner adds guest-kernel USB delivery observation, native background
failure notifications, GNOME portal cancellation and RemoteDesktop decisions,
selection degradation/cancellation, focused-client clipboard observation,
locked/unavailable GNOME Keyring, native chooser, AppIndicator absence/recovery,
Mutter display configuration and session-transition checks. Implementation alone
is not passing evidence; see the new dated follow-up report for actual results.
