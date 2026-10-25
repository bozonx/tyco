# Fedora 44 KDE native automation progress — 2026-10-24–25

This is a historical record of independently executed subcases, not full native acceptance.
See [the 2026-10-25 report](2026-10-25-fedora44-kde-automation.md) for subsequent coverage and findings.
The stand, AppImage fingerprint and product fix are described in
[the smoke report](2026-10-24-fedora44-kde-smoke.md). Full machine-readable
reports and native evidence are retained under the ignored
`dev_files/vm/fedora44-kde/runs/` directory.

| Successful run           | Passed native subcases                                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261024-230653-9cbb00` | Selection capture/replacement/cancellation; plain text and PNG clipboard restoration; PRIMARY preservation; newer clipboard owner retained; real input daemon failure/recovery; closed target rejection; actual Konsole bracketed paste without Enter |
| `20261024-231606-04b92a` | Kate insertion and saved-file bytes; native folder-dialog cancellation; native KWallet wizard, secret-tool lookup, redaction and deletion; actual CPAL capture and stop through a virtual PipeWire microphone                                         |
| `20261024-231903-01350f` | Native shortcut change and disable                                                                                                                                                                                                                    |
| `20261024-232300-bbe699` | Actual US/RU KWin layout switching; Firefox insertion, selection capture and replacement                                                                                                                                                              |
| `20261024-235504-c48063` | Actual input socket permission denial and missing ydotool; restored exact native insertion                                                                                                                                                            |
| `20261024-235624-80ec16` | All available clipboard writer tools removed; explicit error; tools restored and exact insertion recovered                                                                                                                                            |
| `20261024-235827-b12d30` | Empty selection rejected with unchanged foreign text/focus; native GTK picker, Unicode/spaced path, plugin installation/worker initialization/removal                                                                                                 |
| `20261024-235935-9c464f` | Actual PipeWire services/sockets stopped; explicit CPAL error; real nonzero PCM and stop event after recovery                                                                                                                                         |
| `20261025-000029-66d175` | Selection access denied, granted, exact foreign text captured, then revoked and denied without activating Tyco                                                                                                                                        |
| `20261024-234941-aa9edc` | Three real native PAM lock/unlock cycles; three actual logout/login cycles with new session leaders and unchanged boot ID; physical shortcuts recovered after every cycle                                                                             |
| `20261024-234407-caab24` | Native StatusNotifierItem/DBusMenu Show and Quit; CLI command denial, grant, exact multiline execution and revocation                                                                                                                                 |
| `20261024-233112-de1134` | Three real reboots with new boot IDs, restored configuration and physical shortcuts                                                                                                                                                                   |

Each run's `report.json` includes artifact/source/runner fingerprints, environment,
individual check outcomes and diagnostic paths. Earlier failing subcases are
retained in those reports. Corrections were rerun as listed above. The reboot
run as a whole failed other lifecycle checks; only its reboot subcase passed.

At this stage, the native suite still reported automatable gaps as BLOCKED. The ACPI sleep subcase currently fails: the first suspension is observed, but
a subsequent guest sleep returns before the runner observes QEMU suspended state.
This remains a failed automated check.
Neither a written test nor a timeout counts as a successful observation. The
coverage table in [scripts/vm/coverage.md](../../scripts/vm/coverage.md) identifies
remaining scope, including production package acceptance with two real versions.

Clipboard evidence covers plain text and PNG, not HTML-only restoration. Virtual
audio verifies the real capture path; it does not validate physical microphones,
Bluetooth or recognition quality. Native dialog and keychain provisioning are
automated; no human clicks were required for the passed subcases above.
