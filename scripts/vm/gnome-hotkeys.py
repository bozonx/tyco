"""GNOME-managed assignment, revocation and real keyboard layouts."""

from importlib import import_module
import json
import shlex
import time
import uuid

from vmlib import StepFailed, wait_for


def run_checks(*, vm, driver, guest, check, selected, report):
    def require(condition, message):
        if not condition:
            raise StepFailed(message)

    def read():
        try:
            return json.loads(vm.ssh("cat tyco-vm/receiver-wayland.json"))
        except StepFailed:
            return {}

    def setup():
        import_module("gnome-setup").ensure_shortcuts(driver, guest)
        import_module("receiver-session").start_receiver(vm, guest, "wayland")
        wait_for("native shortcut receiver focus", lambda: read().get("focused"))

    def assign(shortcut):
        actual = json.loads(
            guest(
                "env-run python3 tyco-vm/gnome-shortcuts.py quickInput "
                + shlex.quote(shortcut)
            )
        )
        require(
            any(
                name == "quickInput"
                and values.get("shortcuts", []) == ([shortcut] if shortcut else [])
                for name, values in actual
            ),
            "Native assignment differs",
        )
        info = driver.invoke("get_hotkey_provider_info")
        (vm.run_dir / "gnome-shortcut-observed.json").write_text(
            json.dumps(info, indent=2)
        )
        report.setdefault("gnomeShortcutAssignments", []).append(
            {"requested": shortcut, "nativeSettings": actual, "applicationStatus": info}
        )

    def activated(key):
        before = driver.invoke("get_desktop_state")["activation"]["activationId"]
        vm.qmp.tap("ctrl", "alt", key)
        driver.window("quick", "textarea")
        wait_for(
            "native quick focus",
            lambda: (
                driver.invoke("plugin:window|is_focused", {"label": "quick"})
                and driver.execute("return document.hasFocus()")
            ),
        )
        require(
            driver.invoke("get_desktop_state")["activation"]["activationId"]
            == before + 1,
            "Shortcut did not activate exactly once",
        )
        vm.qmp.tap("esc")
        wait_for("native dismissal focus", lambda: read().get("focused"))

    def inactive(key):
        before = driver.invoke("get_desktop_state")["activation"]["activationId"]
        vm.qmp.tap("ctrl", "alt", key)
        until = time.monotonic() + 0.7
        while time.monotonic() < until:
            require(
                driver.invoke("get_desktop_state")["activation"]["activationId"]
                == before
                and read().get("focused"),
                "Removed shortcut activated or stole focus",
            )
            time.sleep(0.05)

    def change_disable():
        setup()
        try:
            assign("<Control><Alt>j")
            inactive("i")
            activated("j")
            assign("")
            inactive("j")
        finally:
            assign("<Control><Alt>i")
        activated("i")
        return "Real GNOME assignment replacement releases old shortcut, new activates once, disabling stops it and restoration works"

    def revoke():
        setup()
        try:
            assign("")
            inactive("i")
        finally:
            assign("<Control><Alt>i")
        activated("i")
        return "Native GNOME shortcut revoked; physical key inactive; reassignment recovers; native settings and application metadata recorded separately"

    def configure_cancel():
        setup()
        driver.window("main", ".cm-editor")
        before = json.loads(guest("env-run python3 tyco-vm/gnome-shortcuts.py"))
        driver.invoke("open_system_hotkey_settings")

        def settings():
            nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
            matches = [
                node
                for node in nodes
                if node["application"] == "gnome-control-center"
                and node.get("showing")
                and node["role"] in ("frame", "dialog")
            ]
            return nodes if matches else None

        report["gnomeShortcutSettingsUi"] = wait_for(
            "real GNOME shortcut settings opened by Tyco", settings, timeout=25
        )
        vm.qmp.screenshot(vm.run_dir / "gnome-shortcut-settings.png")
        vm.qmp.tap("alt", "f4")
        wait_for("native shortcut settings closed", lambda: not settings(), timeout=15)
        after = json.loads(guest("env-run python3 tyco-vm/gnome-shortcuts.py"))
        require(
            dict(before) == dict(after),
            "Closing native settings changed shortcut assignments",
        )
        import_module("receiver-session").start_receiver(vm, guest, "wayland")
        wait_for(
            "foreign receiver after native settings", lambda: read().get("focused")
        )
        activated("i")
        return "Tyco opens actual GNOME shortcut settings; closing without changes preserves native assignments and physical hotkey operation"

    def layouts():
        setup()
        original = guest(
            "env-run gsettings get org.gnome.desktop.input-sources sources"
        ).strip()
        try:
            for layout, letter in (("us", "a"), ("ru", "ф"), ("us", "a")):
                guest(
                    "env-run gsettings set org.gnome.desktop.input-sources sources "
                    + shlex.quote("[('xkb', '" + layout + "')]")
                )
                # Exact native received text proves the actual keymap, independently of settings.
                time.sleep(0.4)
                identifier = uuid.uuid4().hex
                payload = json.dumps({"id": identifier, "action": "reset", "text": ""})
                vm.ssh(
                    "printf %s "
                    + shlex.quote(payload)
                    + " > tyco-vm/receiver-wayland.command.json.tmp && mv tyco-vm/receiver-wayland.command.json.tmp tyco-vm/receiver-wayland.command.json"
                )
                wait_for(
                    "receiver reset before keymap probe",
                    lambda: (
                        vm.ssh(
                            "cat tyco-vm/receiver-wayland.ack 2>/dev/null || true"
                        ).strip()
                        == identifier
                    ),
                )
                vm.qmp.tap("a")
                wait_for(
                    "actual desktop keymap " + layout,
                    lambda: read().get("text") == letter,
                )
                activated("i")
        finally:
            guest(
                "env-run gsettings set org.gnome.desktop.input-sources sources "
                + shlex.quote(original)
            )
        return "Physical Ctrl+Alt+I activates once under native US/RU/US layouts; independent receiver proves actual keymap"

    for identifier, action in (
        ("VM-02.configure-cancel", configure_cancel),
        ("VM-02.change-disable", change_disable),
        ("VM-03.revoke", revoke),
        ("VM-02.us-ru-layouts", layouts),
    ):
        if selected(identifier):
            check(identifier, action)
