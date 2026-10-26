"""Observe a real background-command failure in the desktop notification UI."""

from importlib import import_module
import json
import shlex
import uuid

from vmlib import StepFailed, wait_for


def run_notification_checks(*, vm, driver, guest, check, selected, args):
    if not selected("VM-11.notification"):
        return

    def scenario():
        if args.ctl is None:
            raise StepFailed("--ctl is required")
        driver.window("main", ".cm-editor")
        if vm.config["desktop"] == "GNOME":
            import_module("gnome-setup").ensure_shortcuts(driver, guest)
        for name in ("IsEnabled", "ScreenReaderEnabled"):
            guest(
                "env-run busctl --user set-property org.a11y.Bus /org/a11y/bus org.a11y.Status "
                + name
                + " b true"
            )
        before = driver.invoke("get_desktop_state")["settings"]["userConfig"]
        config = json.loads(json.dumps(before))
        marker = "Tyco VM failure " + uuid.uuid4().hex[:10]
        identifier = "vm-notification-fixture"
        config["commands"].append(
            {
                "id": identifier,
                "name": marker,
                "description": "Native notification fixture",
                "phrases": [],
                "isVoiceEnabled": False,
                "toolId": "script",
                "toolConfig": {
                    "command": "printf '%s' "
                    + shlex.quote(marker)
                    + " >&2; printf %s {{TEXT}} >/dev/null; exit 1"
                },
                "isLlmArgumentParsingEnabled": False,
                "outputAction": "none",
                "isOutputLogged": False,
                "isAvailableExternally": True,
                "isEnabled": True,
            }
        )
        try:
            driver.invoke(
                "save_user_config", {"baseConfig": before, "userConfig": config}
            )
            guest(
                f"env-run systemd-run --user --quiet --collect --unit=tyco-vm-notification-monitor --property=StandardOutput=append:/home/{vm.user}/tyco-vm/notification-monitor.log dbus-monitor --session interface=org.freedesktop.Notifications"
            )
            result = vm.ssh(
                f"python3 tyco-vm/guest.py env-run -- /home/{vm.user}/tyco-vm/tyco-ctl run {identifier} --text fixture --wait --timeout 20 --json > tyco-vm/notification-job.json 2>&1; cat tyco-vm/notification-job.json"
            )
            events = [json.loads(line) for line in result.splitlines() if line.strip()]
            job = events[-1]
            if job.get("state") != "failed" and not (
                job.get("code") == "ExecutionFailed" and marker in job.get("error", "")
            ):
                raise StepFailed(f"Background fixture did not fail: {job}")

            def visible():
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                (vm.run_dir / "notification-native-ui.json").write_text(
                    json.dumps(nodes, indent=2)
                )
                matches = [
                    node
                    for node in nodes
                    if node.get("showing")
                    and marker in node.get("name", "")
                    and node["application"]
                    == (
                        "gnome-shell"
                        if vm.config["desktop"] == "GNOME"
                        else "plasmashell"
                    )
                ]
                return nodes if matches else None

            nodes = wait_for(
                "failure visible in the native desktop notification UI",
                visible,
                timeout=15,
            )
            (vm.run_dir / "native-notification.json").write_text(
                json.dumps(nodes, indent=2)
            )
            vm.qmp.screenshot(vm.run_dir / "native-notification.png")
            return "Real failing external command produced a notification independently observed in the desktop accessibility tree"
        finally:
            guest("env-run systemctl --user stop tyco-vm-notification-monitor.service")
            vm.qmp.tap("esc")
            driver.window("main", ".cm-editor")
            base = driver.invoke("get_desktop_state")["settings"]["userConfig"]
            driver.invoke(
                "save_user_config", {"baseConfig": base, "userConfig": before}
            )

    check("VM-11.notification", scenario)
