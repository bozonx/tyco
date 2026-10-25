"""Answer actual KDE RemoteDesktop requests while a native IPC call is pending."""

import concurrent.futures
import json
import shlex
import time

from vmlib import StepFailed


def invoke_with_remote_desktop_decision(
    driver, guest, report, command, arguments, *, approve=False, require_dialog=False
):
    evidence = {"command": command, "approve": approve, "observed": False}
    report.setdefault("remoteDesktopDecisions", []).append(evidence)
    driver.call("POST", "/timeouts", {"script": 60000})
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(driver.invoke_result, command, arguments)
    application = "xdg-desktop-portal-kde"
    try:
        deadline = time.monotonic() + 30
        while not future.done() and time.monotonic() < deadline:
            nodes = json.loads(
                guest(
                    "env-run python3 tyco-vm/native-ui.py --application " + application,
                    timeout=10,
                )
            )
            is_remote_control = any(
                node.get("showing")
                and node.get("name") == "Remote Control"
                and node.get("role") in ("frame", "dialog")
                for node in nodes
            )
            if is_remote_control:
                if not any(
                    node.get("showing")
                    and node.get("name") == "TyCo is asking for special privileges:"
                    for node in nodes
                ):
                    raise StepFailed("Unexpected native RemoteDesktop requester")
                evidence["nativeUi"] = nodes
                name = "Approve" if approve else "Deny"
                buttons = [
                    node
                    for node in nodes
                    if node.get("showing")
                    and node.get("sensitive")
                    and node.get("name") == name
                    and node.get("role") in ("button", "push button")
                ]
                if len(buttons) == 1:
                    guest(
                        "env-run python3 tyco-vm/native-control.py click "
                        + shlex.join([application, name]),
                        timeout=10,
                    )
                    evidence["observed"] = True
                    break
            time.sleep(0.1)
        if not future.done() and not evidence["observed"]:
            raise StepFailed(
                "RemoteDesktop request neither completed nor exposed its native dialog"
            )
        result = future.result(timeout=30)
        evidence["result"] = result
        if require_dialog and not evidence["observed"]:
            raise StepFailed(
                "RemoteDesktop permission completed without a new native dialog"
            )
        return result
    finally:
        if not future.done() and not evidence["observed"]:
            try:
                guest(
                    "env-run python3 tyco-vm/native-control.py click "
                    + application
                    + " Deny",
                    timeout=10,
                )
            except (StepFailed, TimeoutError):
                pass
        executor.shutdown(wait=False, cancel_futures=True)
        driver.call("POST", "/timeouts", {"script": 20000})
