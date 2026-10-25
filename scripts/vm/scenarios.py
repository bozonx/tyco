"""Native KDE scenarios. Foreign results come from a separate GTK process."""

import base64
import concurrent.futures
import json
import shlex
import time
import traceback
import uuid

from vmlib import StepFailed, wait_for

# Unicode fixtures are expressed as escapes to keep source code English-only.
CORPUS = [
    "ASCII text",
    "\u041f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440",
    "Emoji \U0001f469\u200d\U0001f4bb \U0001f1e6\U0001f1f7",
    "First line\nSecond line\nThird line",
    "Long text " * 512,
]


def require(condition, message):
    if not condition:
        raise StepFailed(message)


def run_scenarios(
    vm,
    driver,
    args,
    guest,
    record,
    report,
    *,
    recover_controls,
    ensure_driver_transport,
):
    main_handle = driver.call("GET", "/window")
    prefix = f"/home/{vm.user}/tyco-vm"

    def check(identifier, function):
        try:
            detail = function()
            record(identifier, "PASS", detail)
            return True
        except Exception as error:
            record(identifier, "FAIL", str(error) or type(error).__name__)
            (vm.run_dir / (identifier + "-exception.txt")).write_text(
                traceback.format_exc()
            )
            try:
                vm.qmp.screenshot(vm.run_dir / f"{identifier}.png")
                (vm.run_dir / f"{identifier}-ui.json").write_text(
                    guest("env-run python3 tyco-vm/native-ui.py all")
                )
            except Exception:
                pass
            return False

    def read_receiver(backend):
        try:
            return json.loads(vm.ssh(f"cat tyco-vm/receiver-{backend}.json"))
        except StepFailed:
            return {}

    def receiver_command(backend, action, **kwargs):
        identifier = uuid.uuid4().hex
        data = json.dumps({"id": identifier, "action": action, **kwargs})
        path = f"tyco-vm/receiver-{backend}.command.json"
        vm.ssh(f"printf %s {shlex.quote(data)} > {path}.tmp && mv {path}.tmp {path}")
        wait_for(
            "receiver command acknowledgement",
            lambda: (
                vm.ssh(
                    f"cat tyco-vm/receiver-{backend}.ack 2>/dev/null || true"
                ).strip()
                == identifier
            ),
        )

    def focus_receiver(backend):
        receiver_command(backend, "present")
        receiver_pid = read_receiver(backend)["pid"]
        state = json.loads(vm.ssh("cat tyco-vm/windows.json"))
        matches = [
            window for window in state["windows"] if window["pid"] == receiver_pid
        ]
        require(len(matches) == 1, f"Ambiguous native {backend} receiver: {matches}")
        identifier = matches[0]["id"]
        source = (
            "const target = workspace.windowList().find(w => w.internalId.toString() === "
            + json.dumps(identifier)
            + "); if (target) workspace.activeWindow = target;"
        )
        path = vm.run_dir / "focus-receiver.js"
        path.write_text(source)
        vm.copy_to(path, "tyco-vm/focus-receiver.js")
        guest(
            "env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s tyco-vm-focus-receiver"
        )
        loaded = guest(
            f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss {prefix}/focus-receiver.js tyco-vm-focus-receiver"
        )
        script_id = int(loaded.split()[-1])
        guest(
            f"env-run busctl --user call org.kde.KWin /Scripting/Script{script_id} org.kde.kwin.Script run"
        )
        wait_for(
            f"independent native {backend} receiver focus",
            lambda: (
                read_receiver(backend).get("focused")
                and json.loads(vm.ssh("cat tyco-vm/windows.json"))["activeWindowId"]
                == identifier
            ),
        )

    def respond_portal(allow=True):
        nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py"))
        (vm.run_dir / "portal-ui.json").write_text(json.dumps(nodes, indent=2))
        candidates = [
            node
            for node in nodes
            if node.get("showing")
            and "bounds" in node
            and node["name"].replace("&", "").lower()
            in (
                ("allow", "accept", "ok", "grant")
                if allow
                else ("cancel", "deny", "reject")
            )
        ]
        if not candidates:
            return False
        require(
            len(candidates) == 1, f"Ambiguous portal acceptance buttons: {candidates}"
        )
        # Wayland accessibility coordinates may be window-relative and the
        # permission dialog can be behind Tyco after WebDriver selects main.
        # Ask the real window manager to focus that uniquely named dialog,
        # then accept its default button with the emulated hardware keyboard.
        source = "const matches = workspace.windowList().filter(w => w.caption.includes('Global Shortcuts Requested')); if (matches.length === 1) workspace.activeWindow = matches[0];"
        script = vm.run_dir / "focus-portal.js"
        script.write_text(source)
        vm.copy_to(script, "tyco-vm/focus-portal.js")
        loaded = guest(
            f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss {prefix}/focus-portal.js tyco-vm-focus-portal"
        )
        identifier = int(loaded.split()[-1])
        guest(
            f"env-run busctl --user call org.kde.KWin /Scripting/Script{identifier} org.kde.kwin.Script run"
        )
        vm.qmp.screenshot(vm.run_dir / "portal-before.png")
        vm.qmp.tap("ret" if allow else "esc")
        return True

    def register_hotkey():
        accepted = False
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(driver.invoke, "get_hotkey_provider_info")
        try:
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                accepted = accepted or respond_portal()
                if future.done():
                    info = future.result()
                    report["hotkeys"] = info
                    require(
                        info["provider"] == "portal",
                        f"GlobalShortcuts unavailable: {info}; see guest app.log",
                    )
                    if info["registered"]:
                        require(
                            "quickInput" in info["systemTriggers"],
                            f"Quick input not registered: {info}",
                        )
                        require(
                            accepted,
                            "Portal registered without observing an authorization dialog; allow scenario was not exercised",
                        )
                        return "Real KDE GlobalShortcuts dialog accepted through QMP; portal registered"
                    future = executor.submit(driver.invoke, "get_hotkey_provider_info")
                time.sleep(0.15)
            raise StepFailed("Timed out waiting for native GlobalShortcuts permission")
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def cancel_portal():
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(driver.invoke, "get_hotkey_provider_info")
        try:
            wait_for(
                "actual cancelable KDE portal",
                lambda: respond_portal(False),
                timeout=30,
            )
            info = future.result(timeout=15)
            require(
                not info["registered"],
                f"Canceled portal still registered shortcuts: {info}",
            )
            ensure_receiver("wayland")
            focus_receiver("wayland")
            before = hotkey_count()
            vm.qmp.tap("ctrl", "alt", "i")
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                require(
                    hotkey_count() == before,
                    "Shortcut activated after portal cancellation",
                )
                time.sleep(0.1)
            report["canceledPortalInfo"] = info
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
        require(
            driver.invoke("get_desktop_state") is not None,
            "Application stopped responding after portal cancellation",
        )
        return "Actual KDE GlobalShortcuts permission canceled; provider unregistered, physical shortcut inactive, application still responds"

    def config_and_history():
        state = driver.invoke("get_desktop_state")
        config = json.loads(json.dumps(state["settings"]["userConfig"]))
        config["appearance"]["theme"] = "dark"
        saved = driver.invoke(
            "save_user_config",
            {"baseConfig": state["settings"]["userConfig"], "userConfig": config},
        )
        require(
            saved["settings"]["userConfig"]["appearance"]["theme"] == "dark",
            "Setting was not saved",
        )
        identifier = driver.invoke(
            "add_editor_history_item",
            {
                "entry": {
                    "text": "VM persistence fixture",
                    "kind": "source",
                    "operation": "aiTask",
                }
            },
        )
        driver.invoke(
            "set_editor_history_item_result",
            {"id": identifier, "result": "VM result fixture"},
        )
        report["historyId"] = identifier
        return "Embedded application started; settings and history written"

    def hotkey_count():
        script = "from pathlib import Path; p=Path.home()/'.local/state/com.tyco.app/logs/tyco.log'; print(p.read_text().count('Activated QuickInput from Hotkey'))"
        return int(vm.ssh("python3 -c " + shlex.quote(script)).strip())

    def quick(backend, text, hotkey=True):
        focus_receiver(backend)
        windows_before = json.loads(vm.ssh("cat tyco-vm/windows.json"))
        before = driver.invoke("get_desktop_state")["activation"]["activationId"]
        count_before = hotkey_count()
        # Taking an IPC snapshot does not activate the main window.
        if hotkey:
            vm.qmp.tap("ctrl", "alt", "i")
        else:
            guest(f"env-run {prefix}/tyco-ctl open quick-input")
        wait_for(
            "hotkey activation",
            lambda: (
                driver.invoke("get_desktop_state")["activation"]["activationId"]
                > before
            ),
        )
        driver.window("quick", "textarea", exclude=(main_handle,))
        state = driver.invoke("get_desktop_state")
        evidence = {"windowsBefore": windows_before, "state": state, "text": text}
        (vm.run_dir / f"activation-{backend}-{count_before}.json").write_text(
            json.dumps(evidence, indent=2)
        )
        require(
            state["activation"]["windowId"] == windows_before["activeWindowId"],
            f"Captured target differs from independently observed active window: {state['activation']['windowId']} != {windows_before['activeWindowId']}",
        )
        require(
            hotkey_count() == count_before + 1,
            "Hotkey must cause exactly one activation",
        )
        # WebKitWebDriver key simulation drops non-BMP code points. Set the
        # UI fixture through the native textarea setter, then observe the
        # actual DOM value before exercising Tyco's insertion action.
        encoded = base64.b64encode(text.encode()).decode()
        points = driver.execute(
            "const input = document.querySelector('textarea'); const text = new TextDecoder().decode(Uint8Array.from(atob(arguments[0]), c => c.charCodeAt(0))); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text); input.dispatchEvent(new Event('input', {bubbles:true})); return Array.from(input.value, c => c.codePointAt(0));",
            [encoded],
        )
        require(
            points == [ord(character) for character in text],
            "WebDriver fixture lost Unicode code points",
        )
        driver.text("textarea", "\ue004")
        wait_for(
            "insert action",
            lambda: driver.execute(
                "return [...document.querySelectorAll('button')].some(b => b.textContent.includes('Insert into window'))"
            ),
        )
        driver.execute(
            "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Insert into window')).click()"
        )
        return count_before

    def insertion(backend):
        guest(f"receiver {backend}")
        wait_for("foreign receiver", lambda: read_receiver(backend).get("pid"))
        for cycle in range(args.cycles):
            receiver_command(backend, "reset")
            text = CORPUS[cycle % len(CORPUS)]
            before = quick(backend, text)

            def delivered(text=text, backend=backend):
                result = read_receiver(backend)
                return result.get("text") == text and result.get("focused")

            wait_for(
                f"exact text and focus in {backend}, cycle {cycle + 1}",
                delivered,
                timeout=15,
            )
            # A real sentinel key reveals stuck Ctrl/Alt and duplicate or late
            # delivery; it must append once to the foreign text, not Tyco.
            vm.qmp.tap("q")
            wait_for(
                "released modifiers and single delivery",
                lambda backend=backend, text=text: (
                    read_receiver(backend).get("text") == text + "q"
                ),
                timeout=5,
            )
            require(
                hotkey_count() == before + 1, "Duplicate activation after insertion"
            )
        vm.qmp.screenshot(vm.run_dir / f"receiver-{backend}.png")
        return f"{args.cycles} physical hotkey/insert/focus cycles; ASCII, Cyrillic, ZWJ, multiline and long text; no stuck modifiers"

    def external_permissions():
        require(args.ctl is not None, "--ctl is required for external-control checks")
        result = json.loads(guest(f"env-run {prefix}/tyco-ctl status"))
        require(result["apiVersion"] == 2, f"Unexpected CLI status: {result}")
        command = f"{prefix}/tyco-ctl open editor --selection --json"
        # Run through env-run and retain the actual CLI exit code and error.
        result = vm.ssh(
            f"python3 tyco-vm/guest.py env-run -- {command} 2>tyco-vm/selection-denied.json; test $? -eq 3 && cat tyco-vm/selection-denied.json"
        )
        require(
            json.loads(result)["code"] == "AccessDenied",
            f"Unexpected permission error: {result}",
        )
        guest(
            "env-run busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface OpenWithText ss editor vm-dbus-fixture"
        )
        driver.call("POST", "/window", {"handle": main_handle})
        wait_for(
            "D-Bus text in editor",
            lambda: driver.execute(
                "return document.querySelector('.cm-content')?.textContent.includes('vm-dbus-fixture')"
            ),
        )
        return "CLI and session D-Bus reachable; selection denied without grant"

    def selected(identifier):
        if identifier.startswith("VM-16.") and not args.isolated_case:
            return False
        return not args.only or any(
            identifier == requested or identifier.startswith(requested + ".")
            for requested in args.only.split(",")
        )

    def ensure_receiver(backend):
        observed = read_receiver(backend)
        if observed.get("pid"):
            probe = f"from pathlib import Path; p=Path('/proc/{int(observed['pid'])}/cmdline'); print(p.read_bytes().replace(bytes([0]),b' ').decode() if p.exists() else '')"
            alive = vm.ssh("python3 -c " + shlex.quote(probe)).strip()
            if "receiver.py" in alive and backend in alive:
                return
        vm.ssh(f"rm -f tyco-vm/receiver-{backend}.json tyco-vm/receiver-{backend}.ack")
        guest(f"receiver {backend}")
        wait_for("independent receiver", lambda: read_receiver(backend).get("pid"))

    def update_config(mutate):
        before = driver.invoke("get_desktop_state")["settings"]["userConfig"]
        after = json.loads(json.dumps(before))
        mutate(after)
        driver.invoke("save_user_config", {"baseConfig": before, "userConfig": after})
        return before

    def activate_quick(backend):
        ensure_receiver(backend)
        focus_receiver(backend)
        receiver_pid = read_receiver(backend)["pid"]

        def focused_target():
            windows = json.loads(vm.ssh("cat tyco-vm/windows.json"))
            return next(
                (
                    window["id"]
                    for window in windows["windows"]
                    if window["id"] == windows["activeWindowId"]
                    and window["pid"] == receiver_pid
                ),
                None,
            )

        expected_target = wait_for(
            "independent receiver focus before activation", focused_target
        )
        previous = driver.invoke("get_desktop_state")["activation"]["activationId"]
        vm.qmp.tap("ctrl", "alt", "i")
        wait_for(
            "quick activation",
            lambda: (
                driver.invoke("get_desktop_state")["activation"]["activationId"]
                > previous
            ),
        )
        driver.window("quick", "textarea", exclude=(main_handle,))
        activation = driver.invoke("get_desktop_state")["activation"]
        require(
            activation["windowId"] == expected_target,
            "Quick activation retained a stale or different native target",
        )
        return activation["activationId"]

    def expect_received(backend, text):
        wait_for(
            "independent exact text and focus",
            lambda: (
                read_receiver(backend).get("text") == text
                and read_receiver(backend).get("focused")
            ),
            timeout=15,
        )

    def selection():
        ensure_receiver("wayland")
        original = update_config(
            lambda config: config["externalAccess"].update(canAccessSelection=True)
        )
        source = "prefix SOURCE suffix"
        try:
            receiver_command(
                "wayland",
                "reset",
                text=source,
                select=True,
                selectStart=7,
                selectEnd=13,
            )
            focus_receiver("wayland")
            guest(f"env-run {prefix}/tyco-ctl open selection-actions --selection")
            driver.window("quick", exclude=(main_handle,))
            activation = driver.invoke("get_desktop_state")["activation"]
            require(
                activation["selectedText"] == "SOURCE",
                f"Wrong captured selection: {activation['selectedText']!r}",
            )
            driver.invoke(
                "paste_into_target_and_hide",
                {"activationId": activation["activationId"], "text": "REPLACED"},
            )
            expect_received("wayland", "prefix REPLACED suffix")
            receiver_command(
                "wayland",
                "reset",
                text=source,
                select=True,
                selectStart=7,
                selectEnd=13,
            )
            focus_receiver("wayland")
            guest(f"env-run {prefix}/tyco-ctl open selection-actions --selection")
            driver.window("quick", exclude=(main_handle,))
            require(
                driver.invoke("get_desktop_state")["activation"]["selectedText"]
                == "SOURCE",
                "Cancellation setup did not capture selection",
            )
            vm.qmp.tap("esc")
            wait_for(
                "cancelled selection window",
                lambda: (
                    not driver.invoke("get_desktop_state")["window"]["isWindowShown"]
                ),
            )
            require(
                read_receiver("wayland")["text"] == source,
                "Cancellation changed the foreign document",
            )
            return "Real selection capture; only the middle fragment replaced; Esc leaves original document unchanged"
        finally:
            update_config(
                lambda config: config["externalAccess"].update(
                    original["externalAccess"]
                )
            )

    def selection_permissions():
        ensure_receiver("wayland")
        original = update_config(
            lambda config: config["externalAccess"].update(canAccessSelection=False)
        )
        source = "Selection grant fixture"
        command = f"{prefix}/tyco-ctl open selection-actions --selection --json"

        def denied():
            before = driver.invoke("get_desktop_state")["activation"]["activationId"]
            result = vm.ssh(
                f"python3 tyco-vm/guest.py env-run -- {command} 2>tyco-vm/selection-grant-denied.json; test $? -eq 3 && cat tyco-vm/selection-grant-denied.json"
            )
            require(
                json.loads(result)["code"] == "AccessDenied",
                "Selection access was not denied",
            )
            require(
                driver.invoke("get_desktop_state")["activation"]["activationId"]
                == before,
                "Denied selection request activated Tyco",
            )

        try:
            receiver_command("wayland", "reset", text=source, select=True)
            focus_receiver("wayland")
            denied()
            update_config(
                lambda config: config["externalAccess"].update(canAccessSelection=True)
            )
            guest("env-run " + command)
            driver.window("quick", exclude=(main_handle,))
            require(
                driver.invoke("get_desktop_state")["activation"]["selectedText"]
                == source,
                "Granted selection request did not read actual foreign text",
            )
            vm.qmp.tap("esc")
            wait_for(
                "dismissed granted selection window",
                lambda: (
                    not driver.invoke("get_desktop_state")["window"]["isWindowShown"]
                ),
            )
            update_config(
                lambda config: config["externalAccess"].update(canAccessSelection=False)
            )
            focus_receiver("wayland")
            denied()
            require(
                read_receiver("wayland")["text"] == source,
                "Selection grant/revocation changed the document",
            )
        finally:
            update_config(
                lambda config: config["externalAccess"].update(
                    original["externalAccess"]
                )
            )
        return "CLI denied selection without grant, captured actual foreign selection after grant, and denied without activation after revocation; document unchanged"

    def empty_selection():
        ensure_receiver("wayland")
        original = update_config(
            lambda config: config["externalAccess"].update(canAccessSelection=True)
        )
        source = "Document without a selection"
        try:
            receiver_command("wayland", "reset", text=source)
            focus_receiver("wayland")
            command = f"{prefix}/tyco-ctl open selection-actions --selection --json"
            result = vm.ssh(
                f"python3 tyco-vm/guest.py env-run -- {command} 2>tyco-vm/empty-selection.json; test $? -ne 0 && cat tyco-vm/empty-selection.json"
            )
            require(
                json.loads(result)["code"] == "SelectionFailed",
                f"Empty selection was not rejected explicitly: {result}",
            )
            require(
                read_receiver("wayland")["text"] == source,
                "Empty selection request changed the document",
            )
            require(
                read_receiver("wayland")["focused"],
                "Empty selection request stole focus",
            )
        finally:
            update_config(
                lambda config: config["externalAccess"].update(
                    original["externalAccess"]
                )
            )
        return "Actual unselected GTK document produced SelectionFailed; text and foreground focus preserved"

    def clipboard_set(mime, data, primary=False):
        encoded = base64.b64encode(data).decode()
        options = "--primary " if primary else ""
        vm.ssh(
            f"printf %s {shlex.quote(encoded)} | base64 -d | python3 tyco-vm/guest.py env-run -- wl-copy {options}--type {shlex.quote(mime)} > /dev/null 2>tyco-vm/clipboard-owner.log"
        )

    def clipboard_read(mime, primary=False):
        script = f"import base64,subprocess; r=subprocess.run(['wl-paste',*{(['--primary'] if primary else [])!r},'--no-newline','--type',{mime!r}],capture_output=True,timeout=3); print(base64.b64encode(r.stdout).decode() if r.returncode==0 else 'UNAVAILABLE')"
        try:
            value = guest("env-run python3 -c " + shlex.quote(script)).strip()
            return None if value == "UNAVAILABLE" else base64.b64decode(value)
        except StepFailed:
            return None

    def clipboard_formats():
        ensure_receiver("wayland")
        fixtures = [
            ("text/plain", b"Original clipboard fixture"),
            (
                "image/png",
                base64.b64decode(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII="
                ),
            ),
        ]
        primary = b"Original PRIMARY fixture"
        for mime, data in fixtures:
            receiver_command("wayland", "reset")
            clipboard_set(mime, data)
            clipboard_set("text/plain", primary, primary=True)
            wait_for(
                "seeded clipboard format",
                lambda mime=mime, data=data: clipboard_read(mime) == data,
            )
            identifier = activate_quick("wayland")
            driver.invoke(
                "paste_into_target_and_hide",
                {"activationId": identifier, "text": "Clipboard paste fixture"},
            )
            expect_received("wayland", "Clipboard paste fixture")
            wait_for(
                f"restored {mime}",
                lambda mime=mime, data=data: clipboard_read(mime) == data,
                timeout=10,
            )
            wait_for(
                "restored PRIMARY",
                lambda: clipboard_read("text/plain", primary=True) == primary,
                timeout=10,
            )
        return "Byte-exact text/PNG restoration and PRIMARY preservation after native paste"

    def clipboard_new_owner():
        ensure_receiver("wayland")
        receiver_command("wayland", "reset")
        clipboard_set("text/plain", b"Old clipboard")
        identifier = activate_quick("wayland")
        driver.invoke(
            "paste_into_target_and_hide",
            {"activationId": identifier, "text": "Temporary paste"},
        )
        expect_received("wayland", "Temporary paste")
        latest = b"New user copy must survive"
        clipboard_set("text/plain", latest)
        wait_for("new clipboard owner", lambda: clipboard_read("text/plain") == latest)
        # Observe the entire delayed-restore window. Any unexpected clipboard
        # change fails immediately; elapsed time alone cannot satisfy this.
        deadline = time.monotonic() + 2
        samples = 0
        while time.monotonic() < deadline:
            require(
                clipboard_read("text/plain") == latest,
                "Delayed restore overwrote a new user's copy",
            )
            samples += 1
            time.sleep(0.05)
        require(samples >= 3, "Insufficient clipboard ownership observations")
        return f"New clipboard ownership survived delayed restoration ({samples} independent reads)"

    def missing_daemon():
        ensure_receiver("wayland")
        receiver_command("wayland", "reset")
        identifier = activate_quick("wayland")
        try:
            guest("env-run sudo systemctl stop tyco-vm-ydotool.service")
            result = driver.invoke_result(
                "paste_into_target_and_hide",
                {"activationId": identifier, "text": "Must not be delivered"},
            )
            require(not result["ok"], "Missing ydotoold was reported as success")
            require(
                read_receiver("wayland")["text"] == "",
                "Input was delivered despite missing input daemon",
            )
        finally:
            guest("env-run sudo systemctl start tyco-vm-ydotool.service")
        identifier = activate_quick("wayland")
        driver.invoke(
            "paste_into_target_and_hide",
            {"activationId": identifier, "text": "Recovered input fixture"},
        )
        expect_received("wayland", "Recovered input fixture")
        return "Stopped ydotoold produces an explicit error without insertion; restart restores native delivery"

    def input_dependency_fault(kind):
        ensure_receiver("wayland")
        receiver_command("wayland", "reset", text="Protected dependency fixture")
        identifier = activate_quick("wayland")
        socket_path = "/run/user/1000/.ydotool_socket"
        if kind == "socket":
            disable = f"sudo chmod 000 {socket_path}"
            restore = f"sudo chmod 600 {socket_path}"
        elif kind == "uinput":
            disable = "sh -c " + shlex.quote(
                "sudo systemctl stop tyco-vm-ydotool.service && sudo mount --bind /dev/null /dev/uinput && (sudo systemctl start tyco-vm-ydotool.service || true)"
            )
            restore = "sh -c " + shlex.quote(
                "sudo umount /dev/uinput && sudo systemctl reset-failed tyco-vm-ydotool.service && sudo systemctl restart tyco-vm-ydotool.service"
            )
        elif kind == "clipboard":
            disable = "sh -c " + shlex.quote(
                'for name in wl-copy xclip xsel; do p=/usr/bin/$name; test ! -f "$p" || sudo mv "$p" "$p.tyco-vm-disabled"; done'
            )
            restore = "sh -c " + shlex.quote(
                'for name in wl-copy xclip xsel; do p=/usr/bin/$name; test ! -f "$p.tyco-vm-disabled" || sudo mv "$p.tyco-vm-disabled" "$p"; done'
            )
        else:
            binary = "/usr/bin/" + kind
            disable = f"sudo mv {binary} {binary}.tyco-vm-disabled"
            restore = f"sudo mv {binary}.tyco-vm-disabled {binary}"
        try:
            guest("env-run " + disable)
            if kind == "uinput":
                wait_for(
                    "input daemon rejected unavailable uinput",
                    lambda: (
                        vm.ssh(
                            "systemctl show tyco-vm-ydotool.service -p ActiveState --value"
                        ).strip()
                        in ("failed", "inactive")
                    ),
                    timeout=15,
                )
            result = driver.invoke_result(
                "paste_into_target_and_hide",
                {"activationId": identifier, "text": "Must not be delivered"},
            )
            require(not result["ok"], f"Unavailable {kind} was reported as success")
            require(
                read_receiver("wayland")["text"] == "Protected dependency fixture",
                "Failed insertion changed the foreign document",
            )
        finally:
            guest("env-run " + restore)
        receiver_command("wayland", "reset")
        identifier = activate_quick("wayland")
        driver.invoke(
            "paste_into_target_and_hide",
            {"activationId": identifier, "text": "Restored dependency fixture"},
        )
        expect_received("wayland", "Restored dependency fixture")
        return f"Actual {kind} access/executable removed; explicit error and unchanged foreign text; restored dependency delivers exact text"

    def same_title_focus_race():
        for backend in ("wayland", "x11"):
            ensure_receiver(backend)
            receiver_command(backend, "title", title="Identical native receiver")
        try:
            receiver_command("wayland", "reset", text="Alpha original", select=True)
            receiver_command("x11", "reset", text="Beta protected")
            identifier = activate_quick("wayland")
            captured = driver.invoke("get_desktop_state")["activation"]["windowId"]
            duplicates = [
                window
                for window in json.loads(vm.ssh("cat tyco-vm/windows.json"))["windows"]
                if window["title"] == "Identical native receiver"
            ]
            require(
                len(duplicates) == 2
                and len({window["id"] for window in duplicates}) == 2,
                "Fixture did not create two same-title native windows",
            )
            driver.invoke(
                "paste_into_target_and_hide",
                {"activationId": identifier, "text": "Alpha replaced"},
            )
            expect_received("wayland", "Alpha replaced")
            require(
                read_receiver("x11")["text"] == "Beta protected",
                "Same-title insertion changed the wrong window",
            )
            receiver_command("wayland", "reset", text="Alpha protected", select=True)
            identifier = activate_quick("wayland")
            require(
                driver.invoke("get_desktop_state")["activation"]["windowId"]
                == captured,
                "Repeated capture changed same-title window identity",
            )
            focus_receiver("x11")
            result = driver.invoke_result(
                "paste_into_target_and_hide",
                {"activationId": identifier, "text": "Race insertion"},
            )
            require(
                read_receiver("x11")["text"] == "Beta protected",
                "Concurrent focus change redirected insertion",
            )
            if result["ok"]:
                expect_received("wayland", "Race insertion")
                outcome = "restored the original target"
            else:
                require(
                    read_receiver("wayland")["text"] == "Alpha protected",
                    "Rejected race changed the original document",
                )
                outcome = "rejected the stale operation"
            report["focusRaceResult"] = result
            return (
                "Two independently identified same-title windows; exact insertion reached the captured window; a concurrent focus switch "
                + outcome
                + " without changing the other document"
            )
        finally:
            for backend in ("wayland", "x11"):
                receiver_command(backend, "title", title="TycoVmReceiver-" + backend)

    def desktop_target():
        for backend in ("wayland", "x11"):
            ensure_receiver(backend)
            receiver_command(backend, "reset", text="Protected desktop fixture")
        focus_receiver("wayland")

        def desktop(enabled):
            if enabled:
                guest(
                    f"env-run systemd-run --user --quiet --collect --unit=tyco-vm-desktop-state python3 {prefix}/desktop-session.py"
                )
            else:
                guest("env-run systemctl --user stop tyco-vm-desktop-state.service")

            def changed():
                value = guest(
                    "env-run busctl --user get-property org.kde.KWin /KWin org.kde.KWin showingDesktop"
                ).strip()
                observations = report.setdefault("desktopVisibility", [])
                if not observations or observations[-1] != {
                    "requested": enabled,
                    "actual": value,
                }:
                    observations.append({"requested": enabled, "actual": value})
                return value == "b " + str(enabled).lower()

            wait_for("actual KWin desktop visibility", changed, timeout=20)

        try:
            desktop(True)
            previous = driver.invoke("get_desktop_state")["activation"]["activationId"]
            vm.qmp.tap("ctrl", "alt", "i")
            wait_for(
                "quick activation from desktop",
                lambda: (
                    driver.invoke("get_desktop_state")["activation"]["activationId"]
                    > previous
                ),
            )
            driver.window("quick", "textarea", exclude=(main_handle,))
            activation = driver.invoke("get_desktop_state")["activation"]
            require(
                not activation["windowId"],
                "Desktop activation retained a stale foreign target",
            )
            result = driver.invoke_result(
                "paste_into_target_and_hide",
                {
                    "activationId": activation["activationId"],
                    "text": "Must not reach a previous window",
                },
            )
            require(
                not result["ok"],
                "Desktop insertion reported success without a foreign target",
            )
            for backend in ("wayland", "x11"):
                require(
                    read_receiver(backend)["text"] == "Protected desktop fixture",
                    "Desktop insertion changed a previous document",
                )
            vm.qmp.tap("esc")
        finally:
            desktop(False)
        return "Actual KWin desktop focused before physical shortcut; no stale target captured; insertion rejected and both foreign documents preserved"

    def fullscreen_overlay():
        ensure_receiver("wayland")
        receiver_command("wayland", "reset")
        focus_receiver("wayland")
        observed = json.loads(vm.ssh("cat tyco-vm/windows.json"))
        target = observed["activeWindowId"]

        def fullscreen(enabled):
            path = vm.run_dir / "fullscreen-fixture.js"
            path.write_text(
                f"const target=workspace.windowList().find(w=>w.internalId.toString()==={json.dumps(target)}); if(target) target.fullScreen={str(enabled).lower()};"
            )
            vm.copy_to(path, "tyco-vm/fullscreen-fixture.js")
            guest(
                "env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s tyco-vm-fullscreen"
            )
            loaded = guest(
                f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss {prefix}/fullscreen-fixture.js tyco-vm-fullscreen"
            )
            guest(
                f"env-run busctl --user call org.kde.KWin /Scripting/Script{int(loaded.split()[-1])} org.kde.kwin.Script run"
            )
            wait_for(
                "actual native fullscreen state",
                lambda: any(
                    window["id"] == target and window["fullScreen"] == enabled
                    for window in json.loads(vm.ssh("cat tyco-vm/windows.json"))[
                        "windows"
                    ]
                ),
            )

        try:
            fullscreen(True)
            identifier = activate_quick("wayland")
            require(
                driver.invoke("get_desktop_state")["activation"]["windowId"] == target,
                "Overlay captured another fullscreen target",
            )
            vm.qmp.screenshot(vm.run_dir / "fullscreen-overlay.png")
            driver.invoke(
                "paste_into_target_and_hide",
                {"activationId": identifier, "text": "Fullscreen overlay fixture"},
            )
            expect_received("wayland", "Fullscreen overlay fixture")
            guest(
                f"env-run {prefix}/tyco-ctl open editor --text 'Fullscreen main window fixture'"
            )
            driver.window("main", ".cm-editor")
            require(
                driver.invoke("get_desktop_state")["window"]["isWindowShown"],
                "Main window did not open above fullscreen target",
            )
            wait_for(
                "native main focus above fullscreen",
                lambda: (
                    lambda state: any(
                        window["id"] == state["activeWindowId"]
                        and window["resourceClass"] == "tyco"
                        for window in state["windows"]
                    )
                )(json.loads(vm.ssh("cat tyco-vm/windows.json"))),
            )
            state = driver.invoke("get_desktop_state")
            driver.invoke(
                "hide_window", {"activationId": state["activation"]["activationId"]}
            )
            wait_for(
                "focus restored after hiding main",
                lambda: read_receiver("wayland").get("focused"),
            )
        finally:
            fullscreen(False)
        return "Independent KWin fullscreen target; real shortcut opened layer-shell overlay, exact insertion/focus restored; main window opened/hidden and original fullscreen state restored"

    def closed_target():
        ensure_receiver("wayland")
        ensure_receiver("x11")
        receiver_command("x11", "reset", text="Protected other window")
        receiver_command("wayland", "reset")
        identifier = activate_quick("wayland")
        target = driver.invoke("get_desktop_state")["activation"]["windowId"]
        receiver_command("wayland", "close")

        def removed():
            windows = json.loads(vm.ssh("cat tyco-vm/windows.json"))["windows"]
            return not any(window["id"] == target for window in windows)

        wait_for("foreign target closed in KWin", removed)
        result = driver.invoke_result(
            "paste_into_target_and_hide",
            {"activationId": identifier, "text": "Must not go to another window"},
        )
        require(
            not result["ok"], "A closed target was reported as a successful insertion"
        )
        require(
            read_receiver("x11")["text"] == "Protected other window",
            "Insertion escaped into another window",
        )
        return (
            "Closed target rejected; independently observed other document is unchanged"
        )

    def run_native_checks():
        for identifier, function in (
            ("VM-05.selection-replace-cancel", selection),
            ("VM-05.empty-selection", empty_selection),
            ("VM-13.selection-grant-revoke", selection_permissions),
            ("VM-07.formats-primary", clipboard_formats),
            ("VM-07.concurrent-owner", clipboard_new_owner),
            ("VM-09.daemon-recovery", missing_daemon),
            ("VM-09.socket-permission", lambda: input_dependency_fault("socket")),
            ("VM-09.clipboard-tool", lambda: input_dependency_fault("clipboard")),
            ("VM-09.input-tool", lambda: input_dependency_fault("ydotool")),
            ("VM-09.uinput-unavailable", lambda: input_dependency_fault("uinput")),
            ("VM-06.closed-target", closed_target),
            ("VM-06.same-title-focus-race", same_title_focus_race),
            ("VM-06.desktop-target", desktop_target),
            ("VM-11.fullscreen-overlay", fullscreen_overlay),
        ):
            if selected(identifier):
                check(identifier, function)

    def recover():
        nonlocal driver, main_handle
        driver = recover_controls()
        main_handle = driver.call("GET", "/window")
        return driver

    def get_driver():
        nonlocal driver
        driver = ensure_driver_transport()
        return driver

    def persistence():
        nonlocal main_handle
        require("historyId" in report, "History setup failed")
        application = prefix + (
            "/Tyco.AppImage" if args.artifact.suffix == ".AppImage" else "/tyco"
        )
        for _ in range(3):
            driver.stop()
            driver.start(application)
            main_handle = driver.call("GET", "/window")
            state = driver.invoke("get_desktop_state")
            require(
                state["settings"]["userConfig"]["appearance"]["theme"] == "dark",
                "Setting lost after restart",
            )
            history = driver.invoke("get_editor_history")
            item = next(
                (item for item in history if item["id"] == report["historyId"]), None
            )
            require(
                item is not None and item["result"] == "VM result fixture",
                "History lost after restart",
            )
            guest(f"env-run {application} editor")
            count = vm.ssh("pgrep -xc tyco").strip()
            require(
                count == "1", f"Second launch created multiple Tyco owners: {count}"
            )
        return "Three native process restarts preserved settings/history; second launches retained a single owner"

    check("VM-01.startup", config_and_history)
    if args.isolated_portal_cancel:
        check("VM-03.cancel", cancel_portal)
        return
    if not check("VM-03.allow", register_hotkey):
        record("VM-02", "BLOCKED", "GlobalShortcuts registration failed")
        record("VM-04", "BLOCKED", "GlobalShortcuts registration failed")
    elif not args.only:
        for backend in ("wayland", "x11"):
            check(f"VM-02-04.{backend}", lambda backend=backend: insertion(backend))
    if args.ctl:
        check("VM-13.default-deny", external_permissions)
    if args.suite in ("native", "package"):
        run_native_checks()
        from hotkeys import run_hotkey_checks

        run_hotkey_checks(
            vm=vm,
            driver=driver,
            guest=guest,
            check=check,
            selected=selected,
            report=report,
            main_handle=main_handle,
            ensure_receiver=ensure_receiver,
            focus_receiver=focus_receiver,
            hotkey_count=hotkey_count,
        )
        from media import run_media_checks

        run_media_checks(
            vm=vm,
            driver=driver,
            guest=guest,
            check=check,
            selected=selected,
            report=report,
        )
        from desktop import run_desktop_checks

        main_handle = run_desktop_checks(
            vm=vm,
            driver=driver,
            args=args,
            guest=guest,
            check=check,
            selected=lambda identifier: (
                selected(identifier)
                or (
                    identifier == "VM-12.secret-lifecycle"
                    and bool(
                        args.isolated_case and args.isolated_case.startswith("VM-16.")
                    )
                )
            ),
            report=report,
            main_handle=main_handle,
        )
        from importlib import import_module

        import_module("command-grants").run_command_grant_checks(
            vm=vm, driver=driver, guest=guest, check=check, selected=selected, args=args
        )
        from lifecycle import run_lifecycle_checks

        run_lifecycle_checks(
            vm=vm,
            get_driver=get_driver,
            guest=guest,
            check=check,
            selected=selected,
            report=report,
            recover=recover,
            activate_quick=activate_quick,
        )
    if not args.only or selected("VM-01.persistence"):
        check("VM-01.persistence", persistence)
