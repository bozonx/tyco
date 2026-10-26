"""Settle the real GNOME shortcut dialog before unrelated native tests."""

import concurrent.futures
import json
import time

from vmlib import StepFailed


def ensure_shortcuts(driver, guest):
    application = "gnome-control-center-global-shortcuts-provider"
    # Listing shortcuts waits behind BindShortcuts while its native dialog is
    # open. Observe and answer that dialog independently of the pending IPC.
    driver.call("POST", "/timeouts", {"script": 60000})
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(driver.invoke, "get_hotkey_provider_info")
    approved = False
    try:
        deadline = time.monotonic() + 40
        while not future.done() and time.monotonic() < deadline:
            nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
            if not approved and any(
                node["application"] == application
                and node["name"] == "Add"
                and node.get("showing")
                and node.get("sensitive")
                for node in nodes
            ):
                guest(
                    f"env-run python3 tyco-vm/native-control.py click {application} Add"
                )
                approved = True
            time.sleep(0.1)
        info = future.result(timeout=5)
        if not info["registered"]:
            raise StepFailed(f"GNOME shortcut registration did not complete: {info}")
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
        if future.done():
            driver.call("POST", "/timeouts", {"script": 20000})
