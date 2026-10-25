"""Real guest lock, login, reboot and ACPI suspend lifecycle scenarios."""

import json
import shlex
import subprocess

from vmlib import StepFailed, wait_for


def require(condition, message):
    if not condition:
        raise StepFailed(message)


def run_lifecycle_checks(
    *, vm, get_driver, guest, check, selected, report, recover, activate_quick
):
    identifiers = (
        "VM-16.lock-unlock",
        "VM-16.suspend-resume",
        "VM-16.logout-login",
        "VM-16.reboot",
    )
    if not any(selected(identifier) for identifier in identifiers):
        return
    from wallet import WalletFixture

    wallet = WalletFixture(guest)
    secret_id = "vm.lifecycle.fixture"
    secret_value = "tyco-vm-persisted-lifecycle-secret-83"
    get_driver().invoke(
        "set_secret",
        {
            "id": secret_id,
            "value": secret_value,
            "origins": ["https://vm-fixture.invalid"],
        },
    )
    report["lifecycleSecretEvidence"] = [
        wallet.assert_available(get_driver(), secret_id, secret_value)
    ]
    report["lifecycleSecretChecks"] = 1

    def boot_id():
        return vm.ssh("cat /proc/sys/kernel/random/boot_id", timeout=10).strip()

    def session():
        code = "import json,subprocess; rows=subprocess.run(['loginctl','list-sessions','--no-legend','--no-pager'],capture_output=True,text=True,check=True).stdout.splitlines(); matches=[r.split()[0] for r in rows if len(r.split())>3 and r.split()[2]=='tester' and r.split()[3]=='seat0']; result=[{'id':s,'leader':subprocess.run(['loginctl','show-session',s,'-p','Leader','--value'],capture_output=True,text=True,check=True).stdout.strip()} for s in matches]; print(json.dumps(result[0] if result else None))"
        return json.loads(vm.ssh("python3 -c " + shlex.quote(code), timeout=15))

    def probe_safely(function):
        try:
            return function()
        except (StepFailed, OSError, subprocess.TimeoutExpired):
            return None

    def verify_hotkey():
        report["lifecycleSecretEvidence"].append(
            wallet.assert_available(get_driver(), secret_id, secret_value)
        )
        report["lifecycleSecretChecks"] += 1
        items = json.loads(
            guest(
                "env-run busctl --user --json=short get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems"
            )
        )["data"]
        trays = [
            item
            for item in items
            if item.endswith(
                "/org/ayatana/NotificationItem/tray_icon_tray_app_main_tray"
            )
        ]
        require(len(trays) == 1, "Recovered desktop lost the tray or duplicated it")
        service, path = trays[0].split("/", 1)
        guest(
            f"env-run busctl --user get-property {service} /{path} org.kde.StatusNotifierItem Menu"
        )
        history = get_driver().invoke("get_editor_history")
        require(
            any(
                item["id"] == report["historyId"]
                and item["result"] == "VM result fixture"
                for item in history
            ),
            "Desktop recovery lost native history",
        )
        activate_quick("wayland")
        vm.qmp.tap("esc")
        wait_for(
            "dismissed lifecycle quick window",
            lambda: (
                not get_driver().invoke("get_desktop_state")["window"]["isWindowShown"]
            ),
        )

    def locked():
        result = vm.ssh(
            "XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus busctl --user call org.freedesktop.ScreenSaver /ScreenSaver org.freedesktop.ScreenSaver GetActive",
            timeout=10,
        )
        return result.strip() == "b true"

    def greeter_ready(unlock=False):
        nodes = json.loads(
            vm.ssh(
                "XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus python3 tyco-vm/native-ui.py --application kscreenlocker_greet"
            )
        )
        return any(
            node.get("application") == "kscreenlocker_greet"
            and node.get("showing")
            and (
                node.get("name") == "Unlock" if unlock else node.get("role") == "label"
            )
            for node in nodes
        )

    def lock_unlock():
        # This account is disposable. A known password lets QMP unlock the
        # actual native accessibility controls without bypassing PAM.
        vm.ssh("printf %s 'tester:tycovmfixture83' | sudo chpasswd")
        original_boot = boot_id()
        for cycle in range(3):
            guest(
                "env-run busctl --user call org.freedesktop.ScreenSaver /ScreenSaver org.freedesktop.ScreenSaver Lock"
            )
            wait_for("actual screen lock", locked, timeout=20)
            wait_for("rendered native screen locker", greeter_ready, timeout=30)
            vm.qmp.screenshot(vm.run_dir / f"screen-lock-{cycle}.png")
            vm.qmp.tap("spc")
            wait_for("native unlock form", lambda: greeter_ready(True), timeout=15)
            vm.ssh(
                "XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus python3 tyco-vm/native-control.py fill-passwords kscreenlocker_greet tycovmfixture83"
            )
            vm.ssh(
                "XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus python3 tyco-vm/native-control.py click kscreenlocker_greet Unlock"
            )
            wait_for(
                "PAM-authenticated native unlock", lambda: not locked(), timeout=30
            )
            require(
                boot_id() == original_boot,
                "Screen unlock unexpectedly rebooted the guest",
            )
            verify_hotkey()
        return "Three real ScreenSaver lock/PAM unlock cycles; same boot; physical hotkey restored after each"

    def reboot():
        evidence = []
        for _ in range(3):
            before = boot_id()
            get_driver().stop()
            vm.ssh(
                "sudo systemd-run --quiet --on-active=1 --timer-property=AccuracySec=100ms systemctl reboot"
            )
            wait_for(
                "new boot identity",
                lambda before=before: probe_safely(lambda: boot_id() != before),
                timeout=180,
                interval=2,
            )
            driver = recover()
            after = boot_id()
            require(after != before, "Reboot did not change boot ID")
            require(
                driver.invoke("get_desktop_state")["settings"]["userConfig"][
                    "appearance"
                ]["theme"]
                == "dark",
                "Reboot lost saved configuration",
            )
            verify_hotkey()
            evidence.append({"before": before, "after": after})
        report["reboots"] = evidence
        return "Three actual reboots with new boot IDs; desktop, configuration and physical hotkey recovered"

    def logout_login():
        evidence = []
        original_boot = boot_id()
        for _ in range(3):
            before = session()
            require(before is not None, "No interactive session found")
            get_driver().stop()
            guest(
                "env-run busctl --user call org.kde.Shutdown /Shutdown org.kde.Shutdown logout"
            )
            wait_for(
                "new interactive login",
                lambda before=before: probe_safely(
                    lambda: (
                        (current := session()) and current["leader"] != before["leader"]
                    )
                ),
                timeout=180,
                interval=2,
            )
            recover()
            after = session()
            require(boot_id() == original_boot, "Logout/login was replaced by a reboot")
            verify_hotkey()
            evidence.append({"before": before, "after": after})
        report["logins"] = evidence
        return "Three actual session terminations and display-manager logins; new session leaders with unchanged boot ID; hotkeys recovered"

    def suspend_resume():
        evidence = []
        modes = vm.ssh("cat /sys/power/mem_sleep").strip()
        require("deep" in modes, f"Guest has no ACPI deep sleep mode: {modes}")
        vm.ssh("printf deep | sudo tee /sys/power/mem_sleep > /dev/null")
        # QMP controls the wake event. Queued virtual USB/network activity must
        # not wake the guest before the suspended state can be observed.
        vm.ssh(
            "sudo sh -c "
            + shlex.quote(
                'for p in /sys/bus/pci/devices/*/power/wakeup /sys/bus/usb/devices/*/power/wakeup; do test ! -f "$p" || echo disabled > "$p"; done'
            )
        )
        for _ in range(3):
            before = boot_id()
            vm.ssh(
                "sudo systemd-run --quiet --on-active=1 --timer-property=AccuracySec=100ms systemctl suspend"
            )
            wait_for(
                "QEMU ACPI suspended state",
                lambda: vm.qmp.execute("query-status")["status"] == "suspended",
                timeout=30,
            )
            vm.qmp.execute("system_wakeup")
            wait_for(
                "guest SSH after ACPI wake",
                lambda: probe_safely(boot_id),
                timeout=60,
                interval=1,
            )
            wait_for(
                "completed guest suspend service",
                lambda: (
                    vm.ssh(
                        "systemctl show systemd-suspend.service -p ActiveState --value"
                    ).strip()
                    == "inactive"
                ),
                timeout=30,
            )
            require(boot_id() == before, "Suspend/resume was replaced by a reboot")
            journal = vm.ssh(
                "sudo journalctl -k -b --no-pager | grep -E 'PM: suspend (entry|exit)'",
                timeout=15,
            )
            require(
                "suspend entry" in journal and "suspend exit" in journal,
                "Kernel suspend/resume evidence is missing",
            )
            verify_hotkey()
            evidence.append({"bootId": before, "kernelEvents": journal})
        report["suspends"] = evidence
        return "Three ACPI deep sleep/QMP wake cycles, kernel entry/exit evidence and unchanged boot ID; physical hotkeys recovered"

    had_case_failure = False
    for identifier, function in (
        ("VM-16.lock-unlock", lock_unlock),
        ("VM-16.suspend-resume", suspend_resume),
        ("VM-16.logout-login", logout_login),
        ("VM-16.reboot", reboot),
    ):
        if selected(identifier):
            try:
                had_case_failure = not check(identifier, function) or had_case_failure
            finally:
                if probe_safely(locked):
                    current = session()
                    if current:
                        vm.ssh(
                            "sudo loginctl unlock-session " + shlex.quote(current["id"])
                        )
                        wait_for(
                            "cleanup of failed locked session",
                            lambda: not locked(),
                            timeout=15,
                        )

    if had_case_failure:
        report["retainedLifecycleFixture"] = {
            "id": secret_id,
            "reason": "Failed isolated case; encrypted fixture retained for diagnostics",
        }
        return
    try:
        wallet.unlock()
        get_driver().window("main", ".cm-editor")
        get_driver().invoke("delete_secret", {"id": secret_id})
    except Exception as error:
        message = str(error)

        def cleanup_failed():
            raise StepFailed(message)

        check("VM-16.fixture-cleanup", cleanup_failed)
