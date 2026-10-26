"""Observe a real background-command failure in the desktop notification UI."""

from importlib import import_module
import re
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
            result = vm.ssh(
                f"python3 tyco-vm/guest.py env-run -- /home/{vm.user}/tyco-vm/tyco-ctl run {identifier} --text fixture --wait --timeout 20 --json > tyco-vm/notification-job.json 2>&1; cat tyco-vm/notification-job.json"
            )
            events = [json.loads(line) for line in result.splitlines() if line.strip()]
            job = events[-1]
            if job.get("state") != "failed" and not (
                job.get("code") == "ExecutionFailed" and marker in job.get("error", "")
            ):
                raise StepFailed(f"Background fixture did not fail: {job}")

            if vm.config["desktop"] == "GNOME":
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                clocks = [
                    node
                    for node in nodes
                    if node["application"] == "gnome-shell"
                    and node["role"] == "label"
                    and node.get("showing")
                    and re.search(r"\d{1,2}:\d{2}", node["name"])
                ]
                if len(clocks) != 1:
                    raise StepFailed(f"Expected one native GNOME clock: {clocks}")
                import_module("native-input").click_native(
                    vm,
                    guest,
                    "gnome-shell",
                    r"\d{1,2}:\d{2}",
                    roles=("label",),
                    pattern=True,
                )
            else:
                vm.qmp.tap("meta_l", "n")

            def visible():
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                matches = [
                    node
                    for node in nodes
                    if node.get("showing")
                    and marker in node.get("name", "")
                    and node["application"] not in ("tyco", "Tyco", "TyCo")
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
            vm.qmp.tap("esc")
            driver.window("main", ".cm-editor")
            base = driver.invoke("get_desktop_state")["settings"]["userConfig"]
            driver.invoke(
                "save_user_config", {"baseConfig": base, "userConfig": before}
            )

    check("VM-11.notification", scenario)
