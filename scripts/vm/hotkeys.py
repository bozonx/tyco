"""Exercise compositor-managed shortcuts with physical QMP input."""

import concurrent.futures
import json
import subprocess
import shlex
import time

from vmlib import StepFailed, wait_for


def require(condition, message):
    if not condition:
        raise StepFailed(message)


def run_hotkey_checks(
    *,
    vm,
    driver,
    guest,
    check,
    selected,
    report,
    main_handle,
    ensure_receiver,
    focus_receiver,
    hotkey_count,
):
    control_alt = 0x04000000 | 0x08000000
    action = ["com.tyco.app", "quickInput", "TyCo", "Open writing mode"]
    action_args = shlex.join(action)
    base = "env-run busctl --user --json=short call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel "

    def assign(key):
        keys = "0" if key is None else f"1 {control_alt | ord(key)}"
        guest(base + f"setForeignShortcut asai 4 {action_args} {keys}")
        expected = [] if key is None else [control_alt | ord(key)]

        def assigned():
            data = json.loads(guest(base + f"shortcut as 4 {action_args}"))["data"]
            values = data[0] if len(data) == 1 and isinstance(data[0], list) else data
            return values == expected

        wait_for("compositor shortcut assignment", assigned)

    def activated(key):
        ensure_receiver("wayland")
        focus_receiver("wayland")
        count = hotkey_count()
        vm.qmp.tap("ctrl", "alt", key.lower())
        wait_for("physical compositor shortcut", lambda: hotkey_count() == count + 1)
        driver.window("quick", "textarea", exclude=(main_handle,))
        vm.qmp.tap("esc")
        wait_for(
            "quick window dismissed",
            lambda: not driver.invoke("get_desktop_state")["window"]["isWindowShown"],
        )
        require(hotkey_count() == count + 1, "Shortcut caused duplicate activations")

    def inactive(key):
        focus_receiver("wayland")
        count = hotkey_count()
        vm.qmp.tap("ctrl", "alt", key.lower())
        deadline = time.monotonic() + 0.6
        while time.monotonic() < deadline:
            require(hotkey_count() == count, "Unassigned shortcut still activates Tyco")
            time.sleep(0.05)

    def change_disable():
        ensure_receiver("wayland")
        try:
            assign("J")
            inactive("I")
            activated("J")
            assign(None)
            inactive("J")
        finally:
            assign("I")
        activated("I")
        return "Real KGlobalAccel reassignment releases old key, activates new key once, disables it and restores original"

    def revoke():
        ensure_receiver("wayland")
        original = driver.invoke("get_desktop_state")["settings"]["userConfig"][
            "hotkeys"
        ]["quickInput"]
        try:
            assign(None)
            inactive("I")
            info = wait_for(
                "portal reports the removed system trigger",
                lambda: (
                    lambda value: (
                        value if not value["systemTriggers"].get("quickInput") else None
                    )
                )(driver.invoke("get_hotkey_provider_info")),
                timeout=15,
            )
            require(
                driver.invoke("get_desktop_state")["settings"]["userConfig"]["hotkeys"][
                    "quickInput"
                ]
                == original,
                "System revocation rewrote the application's desired shortcut",
            )
            report["revokedShortcutInfo"] = info
        finally:
            assign("I")
        activated("I")
        return "Actual compositor shortcut removed; physical key inactive and refreshed portal trigger empty; desired app setting retained; system assignment restored and key activated once"

    def conflict():
        driver.window("main", ".cm-editor")
        occupied = None
        for label, value, keys in (
            ("Alt+F2", 0x08000000 | 0x01000031, ("alt", "f2")),
            ("Alt+Space", 0x08000000 | 0x20, ("alt", "spc")),
            ("Meta+E", 0x10000000 | ord("E"), ("meta_l", "e")),
        ):
            result = json.loads(
                guest(base + f"isGlobalShortcutAvailable is {value} ''")
            )["data"]
            if not (result[0] if isinstance(result, list) else result):
                occupied = {"label": label, "qtKey": value, "keys": keys}
                break
        require(
            occupied is not None,
            "No independently occupied compositor shortcut exists for the conflict fixture",
        )
        before = json.loads(guest(base + f"shortcut as 4 {action_args}"))
        driver.call("POST", "/timeouts", {"script": 60000})
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(driver.invoke_result, "open_system_hotkey_settings")
        application = None
        identifier = None
        expanded = False

        def native_click(name):
            return guest(
                "env-run python3 tyco-vm/native-control.py click "
                + shlex.quote(application)
                + " "
                + shlex.quote(name),
                timeout=10,
            )

        def close_configuration():
            if identifier is None or not any(
                window["id"] == identifier
                for window in json.loads(vm.ssh("cat tyco-vm/windows.json"))["windows"]
            ):
                return
            if application:
                try:
                    native_click("Cancel")
                except (StepFailed, subprocess.TimeoutExpired):
                    pass
            path = vm.run_dir / "close-shortcut-editor.js"
            path.write_text(
                "const target=workspace.windowList().find(w=>w.internalId.toString()==="
                + json.dumps(identifier)
                + "); if(target) target.closeWindow();"
            )
            vm.copy_to(path, "tyco-vm/close-shortcut-editor.js")
            guest(
                "env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s tyco-vm-close-shortcut-editor"
            )
            loaded = guest(
                f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss /home/{vm.user}/tyco-vm/close-shortcut-editor.js tyco-vm-close-shortcut-editor"
            )
            guest(
                f"env-run busctl --user call org.kde.KWin /Scripting/Script{int(loaded.split()[-1])} org.kde.kwin.Script run"
            )

            def closed():
                if not any(
                    window["id"] == identifier
                    for window in json.loads(vm.ssh("cat tyco-vm/windows.json"))[
                        "windows"
                    ]
                ):
                    return True
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                discard = next(
                    (
                        node["name"]
                        for node in nodes
                        if node.get("showing")
                        and node.get("sensitive")
                        and node.get("application") == application
                        and node.get("name") in ("Discard", "Discard Changes")
                    ),
                    None,
                )
                if discard:
                    native_click(discard)
                return False

            wait_for(
                "native shortcut configuration closed without applying changes",
                closed,
                timeout=15,
            )

        try:

            def settings_window():
                candidates = [
                    window
                    for window in json.loads(vm.ssh("cat tyco-vm/windows.json"))[
                        "windows"
                    ]
                    if "shortcut" in window["title"].lower()
                ]
                return candidates[0] if len(candidates) == 1 else None

            identifier = wait_for(
                "native system shortcut window", settings_window, timeout=20
            )["id"]
            path = vm.run_dir / "focus-shortcut-editor.js"
            path.write_text(
                "const target=workspace.windowList().find(w=>w.internalId.toString()==="
                + json.dumps(identifier)
                + "); if(target) workspace.activeWindow=target;"
            )
            vm.copy_to(path, "tyco-vm/focus-shortcut-editor.js")
            loaded = guest(
                f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss /home/{vm.user}/tyco-vm/focus-shortcut-editor.js tyco-vm-shortcut-editor"
            )
            guest(
                f"env-run busctl --user call org.kde.KWin /Scripting/Script{int(loaded.split()[-1])} org.kde.kwin.Script run"
            )
            wait_for(
                "native shortcut editor focus",
                lambda: (
                    json.loads(vm.ssh("cat tyco-vm/windows.json"))["activeWindowId"]
                    == identifier
                ),
            )

            def editor():
                nonlocal expanded, application
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                candidates = [
                    node
                    for node in nodes
                    if node.get("showing")
                    and node.get("sensitive")
                    and node.get("role") in ("button", "push button")
                    and node.get("name", "").strip()
                    in ("Ctrl+Alt+I", "Add custom shortcut")
                ]
                if len(candidates) == 1:
                    application = candidates[0]["application"]
                    return candidates[0]
                rows = [
                    node
                    for node in nodes
                    if node.get("showing")
                    and node.get("role") == "list item"
                    and node.get("name", "").startswith("Open writing mode:")
                ]
                if len(rows) == 1 and not expanded:
                    application = rows[0]["application"]
                    guest(
                        "env-run python3 tyco-vm/native-control.py expand-row "
                        + shlex.quote(application)
                        + " 'Open writing mode:'"
                    )
                    expanded = True
                return None

            button = wait_for("actual native key-sequence recorder", editor, timeout=20)
            native_click(button["name"])
            vm.qmp.tap(*occupied["keys"])

            def warned():
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                report["shortcutConflictUi"] = nodes
                return any(
                    node.get("showing")
                    and node.get("role") in ("button", "push button")
                    and node.get("name", "").replace("&", "").strip().lower()
                    in ("reassign", "reassign shortcut", "steal shortcut")
                    for node in nodes
                )

            wait_for("actual native shortcut conflict warning", warned, timeout=15)
            vm.qmp.screenshot(vm.run_dir / "shortcut-conflict.png")
            native_click("Cancel")
            close_configuration()
            require(
                json.loads(guest(base + f"shortcut as 4 {action_args}")) == before,
                "Canceled conflict changed the original Tyco assignment",
            )
            result = json.loads(
                guest(base + f"isGlobalShortcutAvailable is {occupied['qtKey']} ''")
            )["data"]
            require(
                not (result[0] if isinstance(result, list) else result),
                "Canceled conflict released the other application's shortcut",
            )
            report["shortcutConflict"] = occupied
        except Exception:
            vm.qmp.screenshot(vm.run_dir / "shortcut-conflict-failure.png")
            raise
        finally:
            close_configuration()
            executor.shutdown(wait=False, cancel_futures=True)
            if future.done():
                try:
                    report["shortcutConfigureResult"] = future.result()
                except Exception as error:
                    report["shortcutConfigureError"] = str(error)
            driver.call("POST", "/timeouts", {"script": 20000})
        activated("I")
        return "An independently occupied system shortcut entered in the native recorder produced a real Reassign conflict dialog; cancellation preserved both assignments and original hotkey activated once"

    def layouts():
        ensure_receiver("wayland")
        original = guest(
            "env-run kreadconfig6 --file kxkbrc --group Layout --key LayoutList"
        ).strip()
        original_use = guest(
            "env-run kreadconfig6 --file kxkbrc --group Layout --key Use"
        ).strip()

        def write(key, value):
            guest(
                "env-run "
                + shlex.join(
                    [
                        "kwriteconfig6",
                        "--notify",
                        "--file",
                        "kxkbrc",
                        "--group",
                        "Layout",
                        "--key",
                        key,
                        value,
                    ]
                )
            )

        def reload():
            guest(
                "env-run busctl --user call org.kde.KWin /KWin org.kde.KWin reconfigure"
            )

        try:
            write("LayoutList", "us,ru")
            write("Use", "true")
            reload()

            def ready():
                data = json.loads(
                    guest(
                        "env-run busctl --user --json=short call org.kde.keyboard /Layouts org.kde.KeyboardLayouts getLayoutsList"
                    )
                )["data"]
                return data if "ru" in json.dumps(data) else None

            report["keyboardLayouts"] = wait_for(
                "actual US/RU desktop layouts", ready, timeout=15
            )
            for index in (0, 1, 0):
                guest(
                    f"env-run busctl --user call org.kde.keyboard /Layouts org.kde.KeyboardLayouts setLayout u {index}"
                )
                activated("I")
        finally:
            guest(
                "env-run busctl --user call org.kde.keyboard /Layouts org.kde.KeyboardLayouts setLayout u 0"
            )
            write("LayoutList", original or "us")
            write("Use", original_use or "false")
            reload()
        return "Physical Ctrl+Alt+I activated exactly once in actual US, RU and restored US desktop layouts"

    for identifier, function in (
        ("VM-02.change-disable", change_disable),
        ("VM-02.us-ru-layouts", layouts),
        ("VM-03.revoke", revoke),
        ("VM-02.conflict", conflict),
    ):
        if selected(identifier):
            check(identifier, function)
