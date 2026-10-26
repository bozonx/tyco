"""Actual GNOME session transitions, native authentication and recovery."""

import concurrent.futures
import hashlib
from importlib import import_module
import json
import shlex
import subprocess
import time

from vmlib import StepFailed, wait_for


def run_checks(
    *, vm, args, guest, check, selected, report, get_driver, recover, provision
):
    identifiers = (
        "VM-16.lock-unlock",
        "VM-16.reboot",
        "VM-16.suspend-resume",
        "VM-16.logout-login",
    )
    if not any(selected(identifier) for identifier in identifiers):
        return
    provision()
    identifier = "vm-gnome-lifecycle"
    value = "TycoGnomeExistingCredential83"
    get_driver().invoke(
        "set_secret",
        {"id": identifier, "value": value, "origins": ["https://vm-fixture.invalid"]},
    )
    config = get_driver().invoke("get_desktop_state")["settings"]["userConfig"]
    saved = json.loads(json.dumps(config))
    saved["appearance"]["theme"] = "dark"
    get_driver().invoke("save_user_config", {"baseConfig": config, "userConfig": saved})
    history_text = "GNOME native lifecycle history"
    history_id = get_driver().invoke(
        "add_editor_history_item",
        {"entry": {"text": history_text, "kind": "source", "operation": "aiTask"}},
    )
    native = import_module("native-input")
    prefix = "XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus "

    def require(condition, message):
        if not condition:
            raise StepFailed(message)

    def probe(action):
        try:
            return action()
        except (OSError, StepFailed, subprocess.TimeoutExpired, json.JSONDecodeError):
            return None

    def boot():
        return vm.ssh("cat /proc/sys/kernel/random/boot_id", timeout=5).strip()

    def nodes():
        result = json.loads(vm.ssh(prefix + "python3 tyco-vm/native-ui.py all", timeout=10))
        (vm.run_dir / "gnome-lifecycle-native-ui.json").write_text(json.dumps(result, indent=2))
        return result

    def unlock_keyring():
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(
            get_driver().invoke_result,
            "set_secret",
            {
                "id": "vm-gnome-unlock-probe",
                "value": "UnlockProbe83",
                "origins": ["https://vm-fixture.invalid"],
            },
        )
        try:

            def ready():
                if future.done():
                    return {"completed": True}
                fields = [
                    node
                    for node in nodes()
                    if node.get("showing") and node["role"] == "password text"
                ]
                return (
                    {"application": fields[0]["application"]}
                    if len(fields) == 1
                    else None
                )

            state = wait_for("keyring result or real unlock prompt", ready, timeout=20)
            if "application" in state:
                application = state["application"]
                guest(
                    "env-run python3 tyco-vm/native-control.py fill-passwords "
                    + shlex.join([application, "TycoVmGnomeCollection83"])
                )
                native.click_native(vm, guest, application, "Unlock")
            require(future.result(timeout=20)["ok"], "Native keyring did not recover")
            get_driver().invoke("delete_secret", {"id": "vm-gnome-unlock-probe"})
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def verify():
        driver = get_driver()
        driver.window("main", ".cm-editor")
        require(
            driver.invoke("get_desktop_state")["settings"]["userConfig"]["appearance"][
                "theme"
            ]
            == "dark",
            "Transition lost saved configuration",
        )
        require(
            any(
                item["id"] == history_id for item in driver.invoke("get_editor_history")
            ),
            "Transition lost saved history",
        )
        unlock_keyring()
        observed = json.loads(
            guest("env-run python3 tyco-vm/secret-read.py " + identifier)
        )
        require(
            len(observed["items"]) == 1
            and observed["items"][0]["sha256"]
            == hashlib.sha256(value.encode()).hexdigest(),
            "Existing native credential bytes lost after transition",
        )
        report.setdefault("gnomeLifecycleSecrets", []).append(observed)
        # Recovered portals may offer their native registration again.
        tree = nodes()
        application = "gnome-control-center-global-shortcuts-provider"
        if any(
            node["application"] == application
            and node["name"] == "Add"
            and node.get("showing")
            for node in tree
        ):
            guest(f"env-run python3 tyco-vm/native-control.py click {application} Add")
        guest("receiver wayland")

        def received():
            return json.loads(vm.ssh("cat tyco-vm/receiver-wayland.json"))

        wait_for("native receiver after transition", lambda: received().get("focused"))
        before = driver.invoke("get_desktop_state")["activation"]["activationId"]
        vm.qmp.tap("ctrl", "alt", "i")
        driver.window("quick", "textarea")
        wait_for(
            "native Quick focus after transition",
            lambda: (
                driver.invoke("plugin:window|is_focused", {"label": "quick"})
                and driver.execute("return document.hasFocus()")
            ),
        )
        require(
            driver.invoke("get_desktop_state")["activation"]["activationId"]
            == before + 1,
            "Recovered hotkey did not activate exactly once",
        )
        vm.qmp.tap("esc")
        wait_for("native dismissal after transition", lambda: received().get("focused"))
        vm.ssh(f"kill {received()['pid']}")
        driver.window("main", ".cm-editor")

    def locked():
        return "true" in vm.ssh(
            prefix
            + "gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver --method org.gnome.ScreenSaver.GetActive",
            timeout=10,
        )

    def lock_unlock():
        vm.ssh("printf %s 'tester:tycovmfixture83' | sudo chpasswd")
        guest("env-run gsettings set org.gnome.desktop.lockdown disable-lock-screen false")
        guest("env-run gsettings set org.gnome.desktop.screensaver lock-enabled true")
        original = boot()
        for cycle in range(3):
            guest(
                "env-run gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver --method org.gnome.ScreenSaver.Lock"
            )
            wait_for("actual GNOME lock", locked, timeout=20)
            vm.qmp.tap("ret")

            def password():
                fields = [
                    node
                    for node in nodes()
                    if node.get("showing") and node["role"] == "password text"
                ]
                return fields[0]["application"] if len(fields) == 1 else None

            application = wait_for("GNOME lock password entry", password, timeout=20)
            vm.ssh(
                prefix
                + "python3 tyco-vm/native-control.py fill-passwords "
                + shlex.join([application, "tycovmfixture83"])
            )
            vm.qmp.tap("ret")
            wait_for("PAM-authenticated GNOME unlock", lambda: not locked(), timeout=30)
            require(boot() == original, "Lock/unlock changed boot identity")
            verify()
        return "Three real GNOME lock/PAM unlock cycles; unchanged boot, exact credential bytes and physical hotkey recovery"

    def reboot():
        for cycle in range(3):
            before = boot()
            get_driver().stop()
            vm.ssh(
                "sudo systemd-run --quiet --on-active=1 --timer-property=AccuracySec=100ms systemctl reboot"
            )
            wait_for(
                "new guest boot",
                lambda: probe(lambda: boot() != before),
                timeout=180,
                interval=2,
            )
            recover()
            verify()
        return "Three actual GNOME guest reboots; new boot IDs, exact existing credentials and physical hotkeys recovered"

    def suspend():
        require("deep" in vm.ssh("cat /sys/power/mem_sleep"), "No ACPI deep sleep mode")
        vm.ssh("printf deep | sudo tee /sys/power/mem_sleep >/dev/null")
        for cycle in range(3):
            before = boot()
            vm.ssh(
                'sudo sh -c \'for p in /sys/bus/pci/devices/*/power/wakeup /sys/bus/usb/devices/*/power/wakeup; do test ! -f "$p" || echo disabled > "$p"; done\''
            )
            vm.ssh(
                "sudo systemd-run --quiet --on-active=1 --timer-property=AccuracySec=100ms systemctl suspend"
            )
            wait_for(
                "actual QEMU ACPI suspension",
                lambda: vm.qmp.execute("query-status")["status"] == "suspended",
                timeout=30,
            )
            since = time.monotonic()

            def stable():
                require(
                    vm.qmp.execute("query-status")["status"] == "suspended",
                    "Guest woke without QMP wake",
                )
                return time.monotonic() - since >= 2

            wait_for("stable suspension", stable, timeout=5)
            vm.qmp.execute("system_wakeup")
            wait_for("SSH after wake", lambda: probe(boot), timeout=90)
            wait_for(
                "completed suspend",
                lambda: (
                    vm.ssh(
                        "systemctl show systemd-suspend.service -p ActiveState --value"
                    ).strip()
                    == "inactive"
                ),
                timeout=30,
            )
            require(boot() == before, "Suspend was replaced by reboot")
            verify()
        return "Three observed ACPI suspend/QMP wake cycles; unchanged boot and native credential/hotkey recovery"

    def logout():
        original_boot = boot()
        for cycle in range(3):
            before = guest(
                "env-run loginctl show-user tester -p Display --value"
            ).strip()
            require(before, "No graphical login session")
            get_driver().stop()
            vm.ssh(
                "sudo systemd-run --quiet --on-active=1 loginctl terminate-session "
                + shlex.quote(before)
            )
            wait_for(
                "old graphical session terminated",
                lambda: probe(
                    lambda: (
                        vm.ssh(
                            "loginctl show-session "
                            + shlex.quote(before)
                            + " -p State --value 2>/dev/null || true"
                        ).strip()
                        not in ("active", "online")
                    )
                ),
                timeout=60,
            )
            # GDM's native login UI is driven by physical input, without loginctl unlock.
            vm.qmp.tap("ret")
            for character in "tycovmfixture83":
                vm.qmp.tap(character)
            vm.qmp.tap("ret")
            recover()
            after = guest(
                "env-run loginctl show-user tester -p Display --value"
            ).strip()
            require(
                after and after != before and boot() == original_boot,
                "Logout/login did not produce a new session on the same boot",
            )
            verify()
        return "Three actual session terminations and GDM logins; new session IDs, same boot and native recovery"

    for name, action in (
        (identifiers[0], lock_unlock),
        (identifiers[1], reboot),
        (identifiers[2], suspend),
        (identifiers[3], logout),
    ):
        if selected(name):
            check(name, action)
