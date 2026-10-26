"""Settle the initial real GNOME shortcut dialog before unrelated native tests."""

import json

from vmlib import wait_for


def ensure_shortcuts(driver, guest):
    application = "gnome-control-center-global-shortcuts-provider"

    def ready():
        info = driver.invoke("get_hotkey_provider_info")
        if info["registered"]:
            return {"registered": True}
        nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
        return (
            {"prompt": True}
            if any(
                node["application"] == application
                and node["name"] == "Add"
                and node.get("showing")
                and node.get("sensitive")
                for node in nodes
            )
            else None
        )

    state = wait_for(
        "native GNOME shortcut registration or initial prompt", ready, timeout=30
    )
    if state.get("prompt"):
        guest(f"env-run python3 tyco-vm/native-control.py click {application} Add")
        wait_for(
            "approved GNOME portal registration",
            lambda: driver.invoke("get_hotkey_provider_info")["registered"],
        )
