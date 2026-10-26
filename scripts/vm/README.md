# Automated native Fedora KDE stand

Run from the Tyco repository root on a Linux KVM host. Python 3.11+, QEMU,
qemu-img, SSH/SCP and access to `/dev/kvm` are required. Keep the original base
read-only. The example profile references the existing Fedora 44 KDE base at
`/mnt/disk2/vm/lhc-fedora-kde/base.qcow2` and its SSH identity; change a **copy**
of this profile for another machine. An initial Ubuntu GNOME profile is described below; its coverage is partial.

All generated images, binaries, known hosts and detailed results live in the
ignored `dev_files/vm/` directory. `--vm` selects another Tyco-owned directory.
Do not point it at the original LHC VM directory. The original image must remain
available: prepared images are qcow2 overlays referencing it.

## Prepare once

The local desktop-test Docker image supplies tauri-driver 2.0.5, WebKitWebDriver
and its private ICU libraries. If missing, build the image directly using the
versions pinned by the current repository:

```sh
docker build --file scripts/containers/desktop-smoke.Dockerfile --build-arg PLAYWRIGHT_VERSION=1.64.0 --build-arg RUST_TOOLCHAIN=1.98.1 --tag tyco-desktop-smoke:1.64.0-1.98.1 scripts/containers
```

The image build and guest preparation need network access; later test runs do
not. Tool extraction never gives its container network access. The AppImage bundles its Ubuntu WebKitGTK runtime; Fedora system package
versions do not identify the runtime loaded by the AppImage. Process maps are
collected to distinguish them. The external automation driver also comes from
the image, with isolated ICU dependencies.

```sh
python3 scripts/vm/prepare-tools.py
pnpm test:vm --suite prepare
```

Preparation boots an independent overlay, installs guest dependencies and stops
LHC processes/autostarts in that overlay. It enables a root-owned ydotoold with
a private user-owned socket, prepares the WebDriver, and checks an unlocked real
KDE Wayland session. It does not upgrade the distribution explicitly; dependency
resolution may update installed packages, whose versions are captured in the
preparation report. No package installs happen during subsequent test runs.

A successfully powered-off preparation becomes `prepared.qcow2` (read-only).
A failed preparation keeps its disk and report. Resume it explicitly:

```sh
pnpm test:vm --suite prepare --resume-prepare dev_files/vm/fedora44-kde/runs/FAILED_RUN
```

A new preparation over an existing prepared base is refused. Use a new `--vm`
directory when rebuilding the stand or changing its profile/preparation script.
Only a stopped failed preparation from that same stand can be resumed.

## Build and run

For a Fedora AppImage, build against the existing Ubuntu 24.04 container image.
An AppImage built on a newer host can bundle libraries requiring a glibc version
that the guest does not have. The build cache is separate and persistent.

```sh
python3 scripts/vm/build-appimage.py
pnpm test:vm --suite smoke --artifact "src-tauri/target/container/debug/bundle/appimage/TyCo - typing companion_0.1.0_amd64.AppImage" --ctl src-tauri/target/container/debug/tyco-ctl
```

Build a production package separately; its acceptance uses the native desktop,
CLI and tray, without WebDriver. The build writes a matching `.build.json`
provenance sidecar required by the package suite:

```sh
python3 scripts/vm/build-appimage.py --release
pnpm test:vm --suite package --artifact "src-tauri/target/container/release/bundle/appimage/TyCo - typing companion_0.1.0_amd64.AppImage" --ctl src-tauri/target/container/release/tyco-ctl
```

Production installation, offline launch, native clipboard copy, reinstall,
restart and removal have passed. Upgrade remains BLOCKED until a previous real
release is available. Supply it with `--previous-artifact /path/to/older.AppImage`;
the runner rejects identical hashes, equal versions and downgrades. This upgrade
branch has not been exercised with a real older release. Reinstalling the current
artifact does not test upgrade migrations.

For diagnostics using a host executable (provided its library requirements are
compatible with the guest):

```sh
pnpm tauri:build --debug --no-bundle
cargo build --manifest-path src-tauri/Cargo.toml --locked -p tyco-ctl
pnpm test:vm --suite smoke --artifact src-tauri/target/debug/tyco --ctl src-tauri/target/debug/tyco-ctl
```

The broader native suite executes independent desktop, clipboard, permission,
keychain, audio and session checks. Target a subcase while diagnosing it:

```sh
pnpm test:vm --suite native --only VM-11.tray-show-quit,VM-13.command-grants --artifact "src-tauri/target/container/debug/bundle/appimage/TyCo - typing companion_0.1.0_amd64.AppImage" --ctl src-tauri/target/container/debug/tyco-ctl
```

Run the complete Fedora native suite with:

```sh
pnpm test:vm --suite native --artifact "src-tauri/target/container/debug/bundle/appimage/TyCo - typing companion_0.1.0_amd64.AppImage" --ctl src-tauri/target/container/debug/tyco-ctl
```

Portal cancellation and each session transition run in separate disposable VMs,
then the remaining cases run in a fresh VM. Each run freezes its Python/JS runner
files and records their hashes; later source edits cannot alter that running
snapshot.

Input dependency tests deny actual KDE Remote Control requests when the
RemoteDesktop fallback is offered. `VM-09.portal-fallback` separately removes
ydotool, approves that native permission and checks exact insertion/focus. Main-only
IPC status/settings commands stay in the main webview; test capabilities are not
broadened.

`--only` limits the acceptance scope recorded in the report. Its success does
not certify the whole native suite. VM-16 fixtures change only the disposable
guest account password and auto-login configuration, then reboot that guest
before the checks. Unlock uses actual native greeter controls and PAM. Privileged
session unlock is cleanup after a failure and never counts as a successful test.

Use `--hold-on-failure` only for interactive infrastructure diagnostics; press
Enter to shut down the failed guest. Normal runs always clean up automatically.
Use `--show` to display QEMU and `--keep` to retain a successful test overlay.
Failures always retain the overlay. Every run prints its artifacts directory
and writes `report.json`, native screenshots, QMP events and guest diagnostics.
Large artifacts do not belong in Git. Resource locks prevent concurrent use of
the same stand/port; port availability and the frozen base identity are checked
before boot. Cleanup shuts down the guest and releases locks on failure too.

The test boot has QEMU restricted networking plus a guest output firewall.
Only loopback fixtures and SSH replies are permitted. The runner verifies a
public TCP destination is unreachable. It preserves the actual desktop runtime
and session D-Bus; no Xvfb, private runtime directory, or `dbus-run-session` is
used. The test fixture sets English Tyco UI and Ctrl+Alt+I for quick input before
Tyco first registers with the real desktop portal. Test history is explicitly
enabled with the development setting. Virtual VGA uses explicit software
rendering for WebKit and Qt; all graphics environment overrides are reported.

```sh
pnpm test:vm:unit
```

See [coverage.md](coverage.md) for exact assertions and acceptance gaps. Any
failed or blocked check makes the suite exit nonzero. Historical native findings
include repeated suspend, secret bytes after cold reboot, and microphone removal;
the follow-up report distinguishes fixes from native dependency defects. Unsupported
suites are not silently replaced by smoke or a manual checklist.

Historical baseline: [9d5b3b64 results](../../dev_docs/testing-results/2026-10-25-fedora44-kde-current-head.md).

## Native executable follow-up

AppImage packaging can be excluded while testing the real Fedora desktop.
Build an embedded debug executable with `pnpm tauri:build --debug --no-bundle`
inside the existing Ubuntu build container (the same source mount, user,
`CARGO_HOME` and persistent target directory used by `build-appimage.py`).
Pass the resulting `src-tauri/target/container/debug/tyco` to `--artifact` and
its `tyco-ctl` sibling to `--ctl`. No AppImage is built or installed. This uses
Fedora's system WebKitGTK; record that runtime distinction when comparing reports.
Copy/strip binaries to a separate artifact path before a long run so a later
build cannot replace the tested executable.

`VM-11.multi-monitor` runs in its own disposable Q35 VM with a second VGA device.
It tests two actual connected outputs, mixed DPI, primary changes, left/right
layouts and disabling an output while Quick is visible. Requested KScreen
positions, scales and priorities must match independently observed state before
input is sent. The draft and activation survive output removal. The normal VM
retains one output for the single-output DPI case.

`VM-16.suspend-resume` uses the i440fx (`pc`) machine because QEMU 11.1.1/Q35
fails repeated S3 even without Tyco. Both the chosen machine and extra display
are recorded alongside the profile and in the QEMU command. Sleep is observed
in QMP before waking; no reboot or immediate wake substitutes for suspended state.

Lifecycle secret fixtures cross a real collection lock/unlock boundary before
transitions. This verifies existing durable credentials, not a new key followed
immediately by reboot: KWallet's deferred-write loss window remains a separately
reproduced native dependency defect. Empty values returned by the vault are not
usable Tyco credentials. See the [follow-up report](../../dev_docs/testing-results/2026-10-25-fedora44-kde-followup.md).

Interrupting a parent run forwards SIGINT to its owned isolated child and waits
for guest teardown. Escalation is restricted to that child process group; other
VMs are never targeted. Frozen runner copies and original failed reports remain
available for diagnostics.

After creating a WebDriver session, the controller observes a usable main
window before configuring timeouts. Process-persistence checks also observe
the previous native process exit before starting the next session. Transport
failures retain the HTTP method/path; application operations are not replayed.

## Ubuntu GNOME stand

`profiles/ubuntu2604-gnome.json` uses port 2254 and a separate read-only Tyco
copy of the local Ubuntu source. Create it once, without changing the LHC disk:

```sh
mkdir -p dev_files/vm/ubuntu2604-gnome
cp --reflink=auto /mnt/disk2/vm/lhc-ubuntu2604-gnome/base.qcow2 dev_files/vm/ubuntu2604-gnome/source.qcow2
chmod 444 dev_files/vm/ubuntu2604-gnome/source.qcow2
python3 scripts/vm/run.py --profile scripts/vm/profiles/ubuntu2604-gnome.json --vm dev_files/vm/ubuntu2604-gnome-v2 --suite prepare
```

Always pass both `--profile` and `--vm`: the default stand remains Fedora.
Preparation installs Ubuntu packages and disables only LHC Shell extensions in
the disposable guest; it keeps the real GNOME session and native portals.
Use a fresh stand directory after changing the preparation recipe.

GNOME scenarios are separate from the KWin scenarios. The runner currently
checks startup, process persistence, reported focus-return capability, native
GlobalShortcuts approval, CLI/D-Bus and command grants, GNOME Keyring and PCM
capture. Physical shortcut input uses QMP. Clipboard insertion observes a separate
GTK receiver under Wayland and XWayland. `VM-10.insertion` exercises the UI;
`VM-10.backend-insertion` explicitly exercises the native IPC path and cannot
certify that the UI exposes it. GNOME package/lifecycle controls and the rest of
the full native matrix remain unimplemented; partial results never certify the
whole platform. A disabled insertion button is a failure, not permission to
silently replace the UI action with IPC.

```sh
python3 scripts/vm/run.py --profile scripts/vm/profiles/ubuntu2604-gnome.json --vm dev_files/vm/ubuntu2604-gnome-v2 --suite native --only VM-02.register,VM-12,VM-13,VM-15 --artifact /path/to/tyco --ctl /path/to/tyco-ctl
```

## Run levels and acceptance policy

- `--suite smoke`: three insertion cycles and the essential startup/input path.
- `--suite native`: the applicable native matrix, five insertion/hotkey cycles.
- `--suite native --stress`: the same matrix with at least twenty cycles.
- `--suite native --only ID`: targeted diagnosis; never full-platform acceptance.
- `--suite package`: production installation lifecycle, separately from functionality.

`--cycles N` overrides insertion/activation repetitions (positive, at least twenty
with `--stress`). Session lifecycle cases still perform three real transitions.
Isolated child runners receive the parent's repetition settings.

Build an embedded executable with `python3 scripts/vm/build-appimage.py --no-bundle`.
The build records a provenance sidecar for that executable. Copy/strip a dedicated
artifact before launching a long run; do not overwrite a running suite's binary.

Input observation reads the guest USB keyboard without grabbing it and confirms
kernel delivery before QMP releases a chord. This is fixture evidence; native
focus, exact received text, activation count and released modifiers are still
required application assertions. No failed application action is replayed.

Confirmed OS/dependency/hypervisor defects are recorded external limitations,
not product acceptance blockers. Their original FAIL evidence remains unchanged.
The suite must not silently convert a failure into PASS. Functional acceptance,
package acceptance and hardware validation have separate status.
