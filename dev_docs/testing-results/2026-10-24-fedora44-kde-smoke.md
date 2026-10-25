# Fedora 44 KDE automatic smoke

Result: **PASS**. Finished: `2026-10-24T22:33:34-0300`.

Commit: `5f09eb7fce05cc36ac0a8d80f5aaa440e401ff6d` with the recorded dirty tree.
Dirty diff SHA256: `268ebb1f7e7ff140dc1ba0fcabae4f9ff1519231b33ebd5b2c474bc4ae818ce3`.
AppImage SHA256: `2817eb0427c21408f1bdab81bb4896aa29dfee4ed1367ca659b65a2401d99345`.

The AppImage was built in Ubuntu 24.04: glibc 2.39 and bundled WebKitGTK
2.52.6. The Fedora system WebKitGTK is 2.54.1; that is not the bundled webview.
Guest: Fedora 44 Cloud Edition with KDE Plasma/KWin 6.7.5, Wayland,
SELinux enforcing, virtual VGA with explicit software rendering.
No Node/Rust toolchain was needed to launch the guest artifact.

| Check              | Result | Evidence                                                                                                  |
| ------------------ | ------ | --------------------------------------------------------------------------------------------------------- |
| ENVIRONMENT        | PASS   | Real unlocked KDE Wayland session; external egress blocked                                                |
| VM-01.startup      | PASS   | Embedded application started; settings and history written                                                |
| VM-03.allow        | PASS   | Real KDE GlobalShortcuts dialog accepted through QMP; portal registered                                   |
| VM-02-04.wayland   | PASS   | 20 physical hotkey/insert/focus cycles; ASCII, Cyrillic, ZWJ, multiline and long text; no stuck modifiers |
| VM-02-04.x11       | PASS   | 20 physical hotkey/insert/focus cycles; ASCII, Cyrillic, ZWJ, multiline and long text; no stuck modifiers |
| VM-13.default-deny | PASS   | CLI and session D-Bus reachable; selection denied without grant                                           |
| VM-01.persistence  | PASS   | Three native process restarts preserved settings/history; second launches retained a single owner         |

The run uses QMP keyboard input, native GlobalShortcuts authorization,
separate GTK Wayland/XWayland receivers and an independent KWin observer.
The clipboard, session bus and input devices are not shared with the host.
External guest networking is blocked by QEMU restricted networking and a
guest output firewall; SSH remains available.

The native regression found out-of-order KWin report processing. Serial D-Bus
dispatch for `org.tyco.KwinTracker` fixed the reproduced target-focus timeout.
The before-fix runs remain in the artifact directory; they are not PASS.

Full native/package acceptance is separate from this smoke. Remaining
automatable cases stay BLOCKED until implemented; no manual substitution is
counted as a passing automatic scenario.

Reproduce:

```sh
pnpm test:vm --suite smoke --artifact "src-tauri/target/container/debug/bundle/appimage/TyCo - typing companion_0.1.0_amd64.AppImage" --ctl src-tauri/target/container/debug/tyco-ctl
```

Artifacts (ignored, outside the report history):

- [Machine-readable report](../../dev_files/vm/fedora44-kde/runs/20261024-223137-36d87f/report.json)
- [Guest diagnostics](../../dev_files/vm/fedora44-kde/runs/20261024-223137-36d87f/diagnostics.tar.gz)
- [Native final screenshot](../../dev_files/vm/fedora44-kde/runs/20261024-223137-36d87f/final.png)

Verification: `pnpm check:rust` (format and zero-warning Clippy), 12 window
tracker Rust tests, 9 VM infrastructure/protocol tests, root ESLint and
Prettier for changed supported files.
