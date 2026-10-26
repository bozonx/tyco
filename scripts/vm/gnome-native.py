"""GNOME-specific focus-return safety, clipboard and native dialog acceptance."""

import base64
import concurrent.futures
import json
import shlex
import uuid

from vmlib import StepFailed, wait_for


def run_checks(*, vm, driver, args, guest, check, selected, report):
    from importlib import import_module

    cases = (
        "VM-04.browser",
        "VM-08.gnome-terminal",
        "VM-11.dpi",
        "VM-11.multi-monitor",
        "VM-09.portal-fallback",
        "VM-05.cancel",
        "VM-10.selection-degradation",
        "VM-07.gnome-clipboard",
        "VM-14.dialog-cancel",
        "VM-14.directory-select",
    )
    if not any(selected(identifier) for identifier in cases):
        return
    import_module("gnome-setup").ensure_shortcuts(driver, guest)
    prefix = f"/home/{vm.user}/tyco-vm"

    def require(condition, message):
        if not condition:
            raise StepFailed(message)

    def read(backend="wayland"):
        try:
            return json.loads(vm.ssh(f"cat tyco-vm/receiver-{backend}.json"))
        except StepFailed:
            return {}

    def command(action, backend="wayland", **values):
        identifier = uuid.uuid4().hex
        payload = json.dumps({"id": identifier, "action": action, **values})
        vm.ssh(
            f"printf %s {shlex.quote(payload)} > tyco-vm/receiver-{backend}.command.json.tmp && mv tyco-vm/receiver-{backend}.command.json.tmp tyco-vm/receiver-{backend}.command.json"
        )
        wait_for(
            "receiver command acknowledgement",
            lambda: (
                vm.ssh(
                    f"cat tyco-vm/receiver-{backend}.ack 2>/dev/null || true"
                ).strip()
                == identifier
            ),
        )
        return identifier

    def receiver():
        import_module("receiver-session").start_receiver(vm, guest, "wayland")
        wait_for("independent receiver", lambda: read().get("pid"))
        wait_for("foreign receiver focus", lambda: read().get("focused"))
        command("reset", text="")

    def quick(text):
        guest(f"env-run {prefix}/tyco-ctl open quick-input")
        driver.window("quick", "textarea")
        wait_for(
            "native quick focus",
            lambda: (
                driver.invoke("plugin:window|is_focused", {"label": "quick"})
                and driver.execute("return document.hasFocus()")
            ),
        )
        driver.execute(
            "const el=document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,arguments[0]); el.dispatchEvent(new Event('input',{bubbles:true}));",
            [text],
        )

    def insert():
        driver.text("textarea", "\ue004")
        wait_for(
            "enabled UI insertion",
            lambda: driver.execute(
                "return [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Insert into window')&&!b.disabled)"
            ),
        )
        driver.click_text("Insert into window")

    def cleanup_receiver():
        pid = read().get("pid")
        if pid:
            vm.ssh(f"kill {int(pid)} 2>/dev/null || true")
        driver.window("main", ".cm-editor")

    def cancel():
        receiver()
        try:
            command("reset", text="Original foreign document")
            quick("Canceled draft")
            vm.qmp.tap("esc")
            wait_for("receiver focus after cancellation", lambda: read().get("focused"))
            require(
                read()["text"] == "Original foreign document",
                "Cancel edited the foreign document",
            )
            return "Physical Escape canceled Quick without changing foreign text and returned native focus"
        finally:
            cleanup_receiver()

    def selection():
        receiver()
        driver.window("main", ".cm-editor")
        before = driver.invoke("get_desktop_state")["settings"]["userConfig"]
        current = json.loads(json.dumps(before))
        current["externalAccess"]["canAccessSelection"] = True
        driver.invoke("save_user_config", {"baseConfig": before, "userConfig": current})
        try:
            # Selecting a WebDriver window does not activate it in the compositor.
            if not read().get("focused"):
                command("present")
                vm.qmp.tap("alt", "tab")
            wait_for("foreign focus before selection", lambda: read().get("focused"))
            for has_selection in (True, False):
                command(
                    "reset",
                    text="prefix SOURCE suffix",
                    select=has_selection,
                    selectStart=7,
                    selectEnd=13,
                )
                invocation = (
                    f"{prefix}/tyco-ctl open selection-actions --selection --json"
                )
                result = vm.ssh(
                    f"python3 tyco-vm/guest.py env-run -- {invocation} 2>tyco-vm/gnome-selection-error.json; test $? -ne 0 && cat tyco-vm/gnome-selection-error.json"
                )
                error = json.loads(result)
                require(
                    error["code"] == "SelectionFailed",
                    f"Unsupported selection was reported successful: {error}",
                )
                require(
                    read()["text"] == "prefix SOURCE suffix" and read()["focused"],
                    "Unsupported selection changed text or stole native focus",
                )
            return "Granted selection requests with and without a selection fail explicitly; document and native focus preserved"
        finally:
            driver.window("main", ".cm-editor")
            base = driver.invoke("get_desktop_state")["settings"]["userConfig"]
            driver.invoke(
                "save_user_config", {"baseConfig": base, "userConfig": before}
            )
            cleanup_receiver()

    def clipboard():
        receiver()
        try:
            payload = "GNOME clipboard insertion Кириллица 👩‍💻"
            command(
                "clipboard",
                mime="text/plain;charset=utf-8",
                data=base64.b64encode(b"Previous user copy").decode(),
            )
            quick(payload)
            insert()
            wait_for(
                "exact clipboard-path insertion",
                lambda: read().get("text") == payload and read().get("focused"),
            )
            identifier = command("read-clipboard", mime="text/plain;charset=utf-8")

            def observed():
                raw = vm.ssh("cat tyco-vm/clipboard-read.json 2>/dev/null || true")
                data = json.loads(raw) if raw else {}
                return data if data.get("id") == identifier else None

            result = wait_for("clipboard read by the focused native receiver", observed)
            require(
                base64.b64decode(result["data"]).decode() == payload,
                "GNOME clipboard fallback did not retain inserted text",
            )
            require(read()["focused"], "Clipboard reading stole foreign focus")
            newer = "New user clipboard owner"
            command(
                "clipboard",
                mime="text/plain;charset=utf-8",
                data=base64.b64encode(newer.encode()).decode(),
            )
            # Wait beyond Tyco's delayed restoration interval without reading from a background Wayland client.
            import time

            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                require(read()["focused"], "Background clipboard work stole focus")
                time.sleep(0.1)
            identifier = command("read-clipboard", mime="text/plain;charset=utf-8")
            result = wait_for("new clipboard owner retained", observed)
            require(
                base64.b64decode(result["data"]).decode() == newer,
                "Delayed work overwrote the newer user copy",
            )
            return "GNOME intentionally retains inserted clipboard text without background snapshots; native focus and a newer user copy preserved"
        finally:
            cleanup_receiver()

    def dialog(select_folder=False):
        driver.window("main", ".cm-editor")
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(driver.invoke, "pick_directory")
        try:

            def chooser():
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                return (
                    nodes
                    if any(
                        node.get("showing")
                        and (
                            node.get("name") == "File Chooser Widget"
                            or node.get("role") == "file chooser"
                        )
                        for node in nodes
                    )
                    else None
                )

            nodes = wait_for("actual GTK folder picker", chooser)
            report["gnomeFolderPicker"] = nodes
            if select_folder:
                applications = {
                    node["application"]
                    for node in nodes
                    if node.get("showing")
                    and (
                        node.get("name") == "File Chooser Widget"
                        or node.get("role") == "file chooser"
                    )
                }
                require(
                    len(applications) == 1,
                    f"Ambiguous picker applications: {applications}",
                )
                application = applications.pop()
                guest(
                    "env-run python3 tyco-vm/native-control.py show-folder-location "
                    + shlex.quote(application)
                )

                # The native chooser opens its location entry; physical input preserves the actual dialog path.
                def location_focused():
                    nodes = json.loads(
                        guest("env-run python3 tyco-vm/native-ui.py all")
                    )
                    (vm.run_dir / "gnome-folder-location.json").write_text(
                        json.dumps(nodes, indent=2)
                    )
                    return any(
                        node["application"] == application
                        and node.get("focused")
                        and node["role"] in ("text", "entry")
                        for node in nodes
                    )

                wait_for("focused native location entry", location_focused, timeout=10)
                guest(
                    "env-run python3 tyco-vm/native-control.py fill-focused-entry "
                    + shlex.join(
                        [application, f"/home/{vm.user}/tyco-vm/Folder with spaces"]
                    )
                )
                vm.qmp.tap("ret")

                def confirm():
                    nodes = json.loads(
                        guest("env-run python3 tyco-vm/native-ui.py all")
                    )
                    buttons = [
                        node
                        for node in nodes
                        if node["application"] == application
                        and node.get("showing")
                        and node.get("sensitive")
                        and node["role"] in ("button", "push button")
                        and node["name"]
                        in ("Open", "Select", "Select Folder", "Choose")
                    ]
                    return buttons[0]["name"] if len(buttons) == 1 else None

                ready = wait_for(
                    "native folder response or confirmation",
                    lambda: (
                        {"completed": True}
                        if future.done()
                        else ({"button": name} if (name := confirm()) else None)
                    ),
                )
                if "button" in ready:
                    guest(
                        "env-run python3 tyco-vm/native-control.py click "
                        + shlex.join([application, ready["button"]])
                    )
                require(
                    future.result(timeout=15)
                    == f"/home/{vm.user}/tyco-vm/Folder with spaces",
                    "Picker returned the wrong path",
                )
                return "Native GTK chooser selected the exact spaced directory path"
            vm.qmp.tap("esc")
            require(
                future.result(timeout=15) is None, "Canceled picker returned a path"
            )
            return "Native GTK picker independently observed; physical Escape canceled without a path"
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def terminal():
        driver.window("main", ".cm-editor")
        before = driver.invoke("get_desktop_state")["settings"]["userConfig"]
        config = json.loads(json.dumps(before))
        # GNOME cannot classify the focused application; use the user's explicit shortcut setting.
        config["windowInsertion"]["linux"]["pasteShortcut"] = "Ctrl+Shift+V"
        driver.invoke("save_user_config", {"baseConfig": before, "userConfig": config})
        try:
            guest(
                f"env-run systemd-run --user --quiet --collect --unit=tyco-vm-gnome-terminal gnome-terminal --wait -- python3 {prefix}/terminal.py"
            )

            def observed():
                raw = vm.ssh("cat tyco-vm/terminal.json 2>/dev/null || true")
                return json.loads(raw) if raw else None

            wait_for("native VTE raw terminal receiver", observed)

            def terminal_widget():
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                terminals = [
                    node
                    for node in nodes
                    if node["role"] == "terminal" and node.get("showing")
                ]
                return (
                    {"application": terminals[0]["application"], "nodes": nodes}
                    if len(terminals) == 1
                    else None
                )

            native = wait_for("actual VTE widget", terminal_widget)
            application = native["application"]
            if any(
                node["application"] == application
                and node["name"] == "No"
                and node.get("showing")
                for node in native["nodes"]
            ):
                guest(
                    "env-run python3 tyco-vm/native-control.py click "
                    + shlex.join([application, "No"])
                )
            guest(
                "env-run python3 tyco-vm/native-control.py focus-terminal "
                + shlex.quote(application)
            )
            wait_for(
                "native VTE keyboard focus",
                lambda: any(
                    node["application"] == application
                    and node["role"] == "terminal"
                    and node.get("focused")
                    for node in terminal_widget()["nodes"]
                ),
            )
            text = "GNOME terminal clipboard Кириллица"
            quick(text)
            insert()
            wait_for("actual terminal paste bytes", lambda: observed()["text"] == text)
            require(
                observed()["enterCount"] == 0, "Insertion submitted a terminal command"
            )
            vm.qmp.tap("q")
            wait_for(
                "released terminal modifiers", lambda: observed()["text"] == text + "q"
            )
            require(observed()["enterCount"] == 0, "An Enter reached the terminal")
            return "Real GNOME Terminal receives exact clipboard text with explicitly configured Ctrl+Shift+V; no synthetic Enter and released modifiers"
        finally:
            guest("env-run systemctl --user stop tyco-vm-gnome-terminal.service")
            driver.window("main", ".cm-editor")
            current = driver.invoke("get_desktop_state")["settings"]["userConfig"]
            driver.invoke(
                "save_user_config", {"baseConfig": current, "userConfig": before}
            )

    def browser():
        guest(
            f"env-run systemd-run --user --quiet --collect --unit=tyco-vm-gnome-browser-server python3 {prefix}/browser.py"
        )
        guest(
            f"env-run systemd-run --user --quiet --collect --unit=tyco-vm-gnome-browser python3 {prefix}/web-browser.py"
        )
        try:

            def observed():
                raw = vm.ssh("cat tyco-vm/browser.json 2>/dev/null || true")
                return json.loads(raw) if raw else None

            wait_for(
                "independent native browser field focus",
                lambda: (state := observed()) and state["focused"],
                timeout=30,
            )
            text = "GNOME native browser paste Кириллица 👩‍💻"
            quick(text)
            insert()
            wait_for(
                "exact browser field text and focus",
                lambda: observed()["text"] == text and observed()["focused"],
            )
            require(observed()["changeCount"] == 1, "Browser insertion was duplicated")
            return "Separate native WebKitGTK browser field receives exact Unicode text once and native focus; observation is outside Tyco over loopback HTTP"
        finally:
            guest(
                "env-run systemctl --user stop tyco-vm-gnome-browser.service tyco-vm-gnome-browser-server.service"
            )
            driver.window("main", ".cm-editor")

    def displays(multiple=False):
        def state():
            return json.loads(guest("env-run python3 tyco-vm/gnome-display.py"))

        initial = state()
        report["gnomeInitialDisplay"] = initial
        monitors = initial["monitors"]
        require(
            len(monitors) == (2 if multiple else 1),
            f"Unexpected native monitor count: {monitors}",
        )

        def mode(monitor):
            candidates = [
                item
                for item in monitor[1]
                if 2.0 in item[5]
                and 1.5 in item[5]
                and item[1] <= 2560
                and item[2] <= 1600
            ]
            return (
                min(candidates, key=lambda item: item[1] * item[2])
                if candidates
                else next(
                    (item for item in monitor[1] if item[6].get("is-current")),
                    monitor[1][0],
                )
            )

        def apply(items):
            guest(
                "env-run python3 tyco-vm/gnome-display.py "
                + shlex.quote(json.dumps(items))
            )

            def observed():
                actual = state()
                logical = actual["logical"]
                matches = len(logical) == len(items) and all(
                    any(
                        row[0] == item["x"]
                        and row[1] == item["y"]
                        and row[2] == item["scale"]
                        and row[4] == item["primary"]
                        and any(spec[0] == item["connector"] for spec in row[5])
                        for row in logical
                    )
                    for item in items
                )
                return actual if matches else None

            actual = wait_for(
                "independently observed Mutter layout", observed, timeout=15
            )
            report.setdefault("gnomeMonitorConfigurations", []).append(actual)

        def item(monitor, x, scale, primary):
            return {
                "connector": monitor[0][0],
                "mode": mode(monitor)[0],
                "x": x,
                "y": 0,
                "scale": scale,
                "primary": primary,
            }

        original_layout = []
        for row in initial["logical"]:
            for specification in row[5]:
                monitor = next(
                    monitor for monitor in monitors if monitor[0][0] == specification[0]
                )
                current_mode = next(
                    value for value in monitor[1] if value[6].get("is-current")
                )
                original_layout.append(
                    {
                        "connector": specification[0],
                        "mode": current_mode[0],
                        "x": row[0],
                        "y": row[1],
                        "scale": row[2],
                        "primary": row[4],
                    }
                )
        receiver()
        try:
            supported = mode(monitors[0])[5]
            scales = [scale for scale in (1.0, 1.5, 2.0) if scale in supported]
            require(
                all(scale in scales for scale in (1.0, 1.5, 2.0)),
                f"Missing native DPI modes: {supported}",
            )
            for scale in scales:
                layout = [item(monitors[0], 0, scale, True)]
                if multiple:
                    layout.append(
                        item(
                            monitors[1], round(mode(monitors[0])[1] / scale), 1.0, False
                        )
                    )
                apply(layout)
                quick(f"GNOME native DPI {scale}")
                require(
                    driver.execute(
                        "const r=document.querySelector('textarea').getBoundingClientRect(); return r.width>0&&r.height>0"
                    ),
                    "Quick input is not laid out",
                )
                insert()
                wait_for(
                    "foreign text after DPI change",
                    lambda: (
                        read().get("text", "").endswith(f"GNOME native DPI {scale}")
                        and read().get("focused")
                    ),
                )
                vm.qmp.screenshot(vm.run_dir / f"gnome-scale-{scale}.png")
            if multiple:
                apply(
                    [
                        item(monitors[1], 0, 1.0, True),
                        item(monitors[0], mode(monitors[1])[1], 1.0, False),
                    ]
                )
                quick("GNOME draft survives output removal")
                apply([item(monitors[0], 0, 1.0, True)])
                require(
                    driver.execute("return document.querySelector('textarea').value")
                    == "GNOME draft survives output removal",
                    "Monitor removal lost the draft",
                )
                insert()
                wait_for(
                    "foreign paste after output removal",
                    lambda: (
                        read()
                        .get("text", "")
                        .endswith("GNOME draft survives output removal")
                        and read().get("focused")
                    ),
                )
            return (
                "Real Mutter DPI/layout state observed; native UI insertion and focus after each change"
                + (
                    "; two outputs, primary/layout switch and visible draft survives output removal"
                    if multiple
                    else ""
                )
            )
        finally:
            cleanup_receiver()
            if not multiple:
                apply(original_layout)

    def portal():
        driver.window("main", ".cm-editor")
        binary = guest("env-run sh -c 'command -v ydotool'").strip()
        require(binary.startswith("/usr/"), "Unexpected ydotool path")
        vm.ssh(
            "sudo mv "
            + shlex.quote(binary)
            + " "
            + shlex.quote(binary + ".tyco-vm-disabled")
        )
        driver.call("POST", "/timeouts", {"script": 60000})
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            for approve in (False, True):
                future = executor.submit(
                    driver.invoke_result, "request_text_insertion_permission"
                )

                def prompt():
                    nodes = json.loads(
                        guest("env-run python3 tyco-vm/native-ui.py all")
                    )
                    (vm.run_dir / "gnome-remote-desktop-prompt.json").write_text(
                        json.dumps(nodes, indent=2)
                    )
                    buttons = [
                        node
                        for node in nodes
                        if node["application"] == "xdg-desktop-portal-gnome"
                        and node.get("showing")
                        and node.get("sensitive")
                        and node["role"] in ("button", "push button")
                        and node["name"]
                        in (("Share", "Allow") if approve else ("Cancel", "Deny"))
                    ]
                    requester = any(
                        node["name"] == "Remote Desktop" and node["role"] == "frame"
                        for node in nodes
                        if node["application"] == "xdg-desktop-portal-gnome"
                        and node.get("showing")
                    )
                    return buttons[0] if requester and len(buttons) == 1 else None

                if approve:

                    def switch_ready():
                        nodes = json.loads(
                            guest("env-run python3 tyco-vm/native-ui.py all")
                        )
                        return any(
                            node["application"] == "xdg-desktop-portal-gnome"
                            and node["role"] == "switch"
                            and node.get("showing")
                            for node in nodes
                        )

                    wait_for(
                        "native remote interaction switch", switch_ready, timeout=20
                    )
                    guest(
                        "env-run python3 tyco-vm/native-control.py enable-switch xdg-desktop-portal-gnome 'Allow Remote Interaction'"
                    )
                node = wait_for(
                    "native GNOME RemoteDesktop permission", prompt, timeout=25
                )
                guest(
                    "env-run python3 tyco-vm/native-control.py click "
                    + shlex.join([node["application"], node["name"]])
                )
                result = future.result(timeout=20)
                require(result["ok"], f"Permission status failed: {result}")
                status = result["value"]
                report.setdefault("gnomeRemoteDesktopDecisions", []).append(
                    {"approve": approve, "status": status}
                )
                require(
                    (status["keys"] == "ready") == approve,
                    f"Permission decision incorrectly reported: {status}",
                )
            receiver()
            quick("GNOME portal-only insertion")
            insert()
            wait_for(
                "portal delivered exact foreign text",
                lambda: (
                    read().get("text") == "GNOME portal-only insertion"
                    and read().get("focused")
                ),
            )
            return "Real GNOME RemoteDesktop denial and approval without ydotool; approved portal delivers exact text and native focus"
        finally:
            vm.ssh(
                "sudo mv "
                + shlex.quote(binary + ".tyco-vm-disabled")
                + " "
                + shlex.quote(binary)
            )
            executor.shutdown(wait=False, cancel_futures=True)

    guest("env-run mkdir -p " + shlex.quote(prefix + "/Folder with spaces"))
    for identifier, action in (
        ("VM-04.browser", browser),
        ("VM-08.gnome-terminal", terminal),
        ("VM-11.dpi", displays),
        ("VM-11.multi-monitor", lambda: displays(True)),
        ("VM-09.portal-fallback", portal),
        ("VM-05.cancel", cancel),
        ("VM-10.selection-degradation", selection),
        ("VM-07.gnome-clipboard", clipboard),
        ("VM-14.dialog-cancel", dialog),
        ("VM-14.directory-select", lambda: dialog(True)),
    ):
        if selected(identifier):
            check(identifier, action)
