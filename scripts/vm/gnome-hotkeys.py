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
        guest("receiver wayland")
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
        expected = shortcut.replace("<Control>", "").replace("<Alt>", "").lower()

        def refreshed():
            info = driver.invoke("get_hotkey_provider_info")
            trigger = info["systemTriggers"].get("quickInput", "")
            return (
                info
                if (
                    (expected and trigger.lower().endswith(expected))
                    or (not expected and not trigger)
                )
                else None
            )

        report.setdefault("gnomeShortcutAssignments", []).append(
            wait_for("portal observes native assignment", refreshed)
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
        return "Native GNOME shortcut revoked; portal reports no trigger; physical key inactive; reassignment recovers"

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
                        vm.ssh("cat tyco-vm/receiver-wayland.ack").strip() == identifier
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
        ("VM-02.change-disable", change_disable),
        ("VM-03.revoke", revoke),
        ("VM-02.us-ru-layouts", layouts),
    ):
        if selected(identifier):
            check(identifier, action)
