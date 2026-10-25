"""Native application, file-dialog and keychain scenarios for KDE."""

import base64
import concurrent.futures
import json
import re
from pathlib import PurePosixPath
import shlex

from vmlib import ROOT, StepFailed, wait_for


def require(condition, message):
    if not condition:
        raise StepFailed(message)


def run_desktop_checks(
    *, vm, driver, args, guest, check, selected, report, main_handle
):
    prefix = f"/home/{vm.user}/tyco-vm"

    def windows():
        return json.loads(vm.ssh("cat tyco-vm/windows.json"))

    def window_for(predicate):
        return wait_for(
            "native application window",
            lambda: next(
                (window for window in windows()["windows"] if predicate(window)), None
            ),
            timeout=30,
        )

    def focus(window):
        identifier = window["id"]
        source = f"const target = workspace.windowList().find(w => w.internalId.toString() === {json.dumps(identifier)}); if (target) workspace.activeWindow = target;"
        path = vm.run_dir / "focus-native.js"
        path.write_text(source)
        vm.copy_to(path, "tyco-vm/focus-native.js")
        guest(
            "env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s tyco-vm-focus-native"
        )
        loaded = guest(
            f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss {prefix}/focus-native.js tyco-vm-focus-native"
        )
        script_id = int(loaded.split()[-1])
        guest(
            f"env-run busctl --user call org.kde.KWin /Scripting/Script{script_id} org.kde.kwin.Script run"
        )
        wait_for(
            "independently observed native focus",
            lambda: windows()["activeWindowId"] == identifier,
        )

    def start(unit, argv):
        guest(
            "env-run "
            + shlex.join(
                [
                    "systemd-run",
                    "--user",
                    "--quiet",
                    "--collect",
                    f"--unit=tyco-vm-{unit}",
                    f"--property=StandardOutput=append:{prefix}/{unit}.log",
                    f"--property=StandardError=append:{prefix}/{unit}.log",
                    *argv,
                ]
            )
        )

    def insert(window, text, observe_quick=None):
        focus(window)
        before = driver.invoke("get_desktop_state")["activation"]["activationId"]
        vm.qmp.tap("ctrl", "alt", "i")
        wait_for(
            "physical quick-input hotkey",
            lambda: (
                driver.invoke("get_desktop_state")["activation"]["activationId"]
                > before
            ),
        )
        driver.window("quick", "textarea", exclude=(main_handle,))
        state = driver.invoke("get_desktop_state")["activation"]
        require(
            state["windowId"] == window["id"],
            "Native insertion captured a different window",
        )
        if observe_quick is not None:
            observe_quick()
        driver.invoke(
            "paste_into_target_and_hide",
            {"activationId": state["activationId"], "text": text},
        )
        wait_for(
            "native target focus after paste",
            lambda: windows()["activeWindowId"] == window["id"],
        )

    def kate():
        path = prefix + "/foreign document.txt"
        vm.ssh("printf %s '' > " + shlex.quote(path))
        start("kate", ["kate", "--new", "--block", path])
        window = window_for(
            lambda window: (
                "kate" in window["resourceClass"].lower()
                and "foreign document.txt" in window["title"]
            )
        )
        text = "Kate native insertion fixture"
        insert(window, text)
        vm.qmp.tap("ctrl", "s")
        wait_for(
            "Kate saved actual document",
            lambda: vm.ssh("cat " + shlex.quote(path)) in (text, text + "\n"),
        )
        vm.qmp.screenshot(vm.run_dir / "kate.png")
        return "Actual Kate document received exact text once and saved through Ctrl+S (editor final-newline policy allowed)"

    def terminal():
        start(
            "konsole",
            ["konsole", "--separate", "-e", "python3", prefix + "/terminal.py"],
        )
        wait_for(
            "raw terminal receiver",
            lambda: vm.ssh(
                "test -f tyco-vm/terminal.json && cat tyco-vm/terminal.json || true"
            ).strip(),
        )
        window = window_for(lambda window: "konsole" in window["resourceClass"].lower())
        text = "Terminal native insertion fixture"
        insert(window, text)

        def received():
            return json.loads(vm.ssh("cat tyco-vm/terminal.json"))

        wait_for("Konsole paste bytes", lambda: received()["text"] == text)
        require(received()["enterCount"] == 0, "Insertion sent Enter to the terminal")
        vm.qmp.tap("q")
        wait_for(
            "terminal released modifiers", lambda: received()["text"] == text + "q"
        )
        require(
            received()["enterCount"] == 0,
            "Terminal received an implicit command submission",
        )
        vm.qmp.screenshot(vm.run_dir / "konsole.png")
        return "Actual Konsole Ctrl+Shift+V delivered exact bytes; no Enter or shell execution; modifiers released"

    def browser():
        profile = prefix + "/firefox-profile"
        vm.ssh("mkdir -p " + shlex.quote(profile))
        preferences = 'user_pref("browser.aboutwelcome.enabled",false); user_pref("browser.shell.checkDefaultBrowser",false); user_pref("browser.startup.homepage_override.mstone","ignore");'
        vm.ssh(
            "printf %s "
            + shlex.quote(preferences)
            + " > "
            + shlex.quote(profile + "/user.js")
        )
        start("browser-server", ["python3", prefix + "/browser.py"])
        start(
            "firefox",
            [
                "firefox",
                "--no-remote",
                "--profile",
                profile,
                "--new-window",
                "http://127.0.0.1:8731/",
            ],
        )

        def observed():
            raw = vm.ssh("cat tyco-vm/browser.json 2>/dev/null || true")
            return json.loads(raw) if raw else None

        wait_for("independent browser page", observed, timeout=45)
        window = window_for(
            lambda window: (
                "firefox" in window["resourceClass"].lower()
                and "Tyco VM Browser Receiver" in window["title"]
            )
        )
        text = "Browser native insertion fixture"
        insert(window, text)
        wait_for(
            "actual Firefox text and focus",
            lambda: observed()["text"] == text and observed()["focused"],
        )
        focus(window)
        vm.qmp.tap("ctrl", "a")
        before = driver.invoke("get_desktop_state")["settings"]["userConfig"]
        after = json.loads(json.dumps(before))
        after["externalAccess"]["canAccessSelection"] = True
        driver.invoke("save_user_config", {"baseConfig": before, "userConfig": after})
        try:
            guest(f"env-run {prefix}/tyco-ctl open selection-actions --selection")
            driver.window("quick", exclude=(main_handle,))
            activation = driver.invoke("get_desktop_state")["activation"]
            require(
                activation["selectedText"] == text,
                "Browser selection was not captured exactly",
            )
            driver.invoke(
                "paste_into_target_and_hide",
                {
                    "activationId": activation["activationId"],
                    "text": "Browser replacement fixture",
                },
            )
            wait_for(
                "actual browser selection replacement",
                lambda: (
                    observed()["text"] == "Browser replacement fixture"
                    and observed()["focused"]
                ),
            )
        finally:
            current = driver.invoke("get_desktop_state")["settings"]["userConfig"]
            restored = json.loads(json.dumps(current))
            restored["externalAccess"] = before["externalAccess"]
            driver.invoke(
                "save_user_config", {"baseConfig": current, "userConfig": restored}
            )
        vm.qmp.screenshot(vm.run_dir / "firefox.png")
        guest(
            "env-run systemctl --user stop tyco-vm-firefox.service tyco-vm-browser-server.service"
        )
        return "Actual Firefox received text and focus; native browser selection captured/replaced; receiver observed over loopback outside Tyco"

    def file_dialog_cancel():
        driver.window("main", ".cm-editor")
        before = {window["id"] for window in windows()["windows"]}
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(driver.invoke, "pick_directory")
        try:
            window = window_for(
                lambda window: (
                    window["id"] not in before
                    and (
                        window["dialog"]
                        or "portal" in window["resourceClass"]
                        or window["title"] == "Select Folder"
                    )
                )
            )
            focus(window)
            vm.qmp.screenshot(vm.run_dir / "file-dialog.png")
            vm.qmp.tap("esc")
            require(
                future.result(timeout=15) is None,
                "Cancelled native dialog returned a path",
            )
            return "Real native directory dialog observed independently; QMP Esc returned cancellation without a path"
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def directory_select():
        driver.window("main", ".cm-editor")
        folder = f"/home/{vm.user}"
        before = {window["id"] for window in windows()["windows"]}
        driver.call("POST", "/timeouts", {"script": 60000})
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(driver.invoke, "pick_directory")
        try:
            dialog = window_for(
                lambda window: (
                    window["id"] not in before and window["title"] == "Select Folder"
                )
            )
            focus(dialog)
            wait_for(
                "native directory form ready",
                lambda: any(
                    node.get("showing") and node.get("name") == "File Chooser Widget"
                    for node in json.loads(
                        guest("env-run python3 tyco-vm/native-ui.py --application tyco")
                    )
                ),
                timeout=10,
            )
            report["directoryLocationAction"] = json.loads(
                guest(
                    "env-run python3 tyco-vm/native-control.py show-folder-location tyco"
                )
            )

            def primary_action():
                nodes = json.loads(
                    guest("env-run python3 tyco-vm/native-ui.py --application tyco")
                )
                report["nativeDirectoryUi"] = nodes
                vm.qmp.screenshot(vm.run_dir / "directory-response.png")
                buttons = [
                    node["name"]
                    for node in nodes
                    if node.get("showing")
                    and node.get("sensitive")
                    and node.get("role") in ("button", "push button")
                    and node.get("name")
                    in ("Open", "Select", "Select Folder", "Choose", "OK")
                ]
                return buttons[0] if len(buttons) == 1 else None

            def response_ready():
                if future.done():
                    return {"completed": True}
                primary = primary_action()
                return {"button": primary} if primary else None

            ready = wait_for(
                "native folder navigation or selection completed",
                response_ready,
                timeout=10,
            )
            vm.qmp.screenshot(vm.run_dir / "directory-selection-ready.png")
            if "button" in ready:
                guest(
                    "env-run python3 tyco-vm/native-control.py click tyco "
                    + shlex.quote(ready["button"])
                )
            selected_path = future.result(timeout=15)
            require(
                isinstance(selected_path, str)
                and PurePosixPath(selected_path) == PurePosixPath(folder),
                f"Native directory picker returned another path: {selected_path}",
            )
            vm.ssh("test -d " + shlex.quote(selected_path))
            report["selectedDirectory"] = selected_path
            return "Actual native GTK folder picker selected the exact existing home directory through its native location and confirmation controls"
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
            try:
                guest(
                    "env-run python3 tyco-vm/native-control.py click tyco Cancel",
                    timeout=10,
                )
            except (StepFailed, TimeoutError):
                pass
            driver.call("POST", "/timeouts", {"script": 20000})

    def plugin_lifecycle():
        driver.window("main", ".cm-editor")
        identifier = "VmNativeFixture"
        locales = json.loads(
            (ROOT / "packages/plugin-sdk/src/locales.json").read_text()
        )
        manifest = {
            "id": identifier,
            "version": "1.0.0",
            "apiVersion": 2,
            "capabilities": [],
            "label": "VM native fixture",
            "defaultLocale": "en-US",
            "locales": {locale: {} for locale in locales},
        }
        module = (
            "export default () => ({ ..."
            + json.dumps(manifest)
            + ", async init(ctx) { await ctx.toastText('VM native plugin initialized', 'success'); } })"
        )
        package = {"formatVersion": 1, "manifest": manifest, "module": module}
        local = vm.run_dir / "plugin path \u00e9.tyco-plugin"
        local.write_text(json.dumps(package))
        vm.copy_to(local, "tyco-vm/")
        remote = prefix + "/" + local.name
        before_windows = {window["id"] for window in windows()["windows"]}
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(driver.invoke, "pick_plugin_package")
        installed = False
        before_config = None
        try:
            dialog = window_for(
                lambda window: (
                    window["id"] not in before_windows
                    and (
                        window["dialog"]
                        or "portal" in window["resourceClass"]
                        or window["title"] in ("Open File", "Open")
                    )
                )
            )
            focus(dialog)
            encoded = base64.b64encode(remote.encode()).decode()
            vm.ssh(
                f"printf %s {encoded} | base64 -d | python3 tyco-vm/guest.py env-run -- wl-copy --type text/plain > /dev/null 2>tyco-vm/plugin-clipboard.log"
            )
            vm.qmp.tap("ctrl", "l")
            vm.qmp.tap("ctrl", "v")
            wait_for(
                "native picker received exact package path",
                lambda: json.loads(
                    guest(
                        "env-run python3 tyco-vm/native-control.py has-text tyco "
                        + shlex.quote(remote)
                    )
                )["matched"],
                timeout=10,
            )
            guest("env-run python3 tyco-vm/native-control.py click tyco Open")
            preview = future.result(timeout=20)
            require(
                preview and preview["manifest"]["id"] == identifier,
                "Native picker inspected another plugin",
            )
            driver.invoke(
                "install_plugin_package", {"inspectionId": preview["inspectionId"]}
            )
            installed = True
            require(
                any(
                    item["manifest"]["id"] == identifier
                    for item in driver.invoke("list_installed_plugins")
                ),
                "Installed package is missing",
            )
            before_config = driver.invoke("get_desktop_state")["settings"]["userConfig"]
            config = json.loads(json.dumps(before_config))
            config["plugins"][identifier] = {"isEnabled": True, "settings": {}}
            driver.invoke(
                "save_user_config", {"baseConfig": before_config, "userConfig": config}
            )
            wait_for(
                "actual isolated plugin initialization",
                lambda: driver.execute(
                    "return document.body.textContent.includes('VM native plugin initialized')"
                ),
            )
            driver.invoke("uninstall_plugin_package", {"id": identifier})
            installed = False
            require(
                all(
                    item["manifest"]["id"] != identifier
                    for item in driver.invoke("list_installed_plugins")
                ),
                "Uninstalled package remains listed",
            )
            report["nativePluginInspection"] = preview
            return "Native GTK picker selected a package with spaces/non-ASCII path; inspection, installation, isolated worker initialization and uninstall observed"
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
            if installed:
                driver.invoke_result("uninstall_plugin_package", {"id": identifier})
            if before_config is not None:
                current = driver.invoke("get_desktop_state")["settings"]["userConfig"]
                driver.invoke(
                    "save_user_config",
                    {"baseConfig": current, "userConfig": before_config},
                )

    def multi_monitor():
        from monitors import run_monitor_check

        return run_monitor_check(
            vm=vm,
            driver=driver,
            guest=guest,
            report=report,
            start=start,
            window_for=window_for,
            windows=windows,
            insert=insert,
        )

    def dpi():
        def output():
            return re.sub(r"\x1b\[[0-9;]*m", "", guest("env-run kscreen-doctor -o"))

        before = output()
        displays = re.findall(r"Output:\s+(\d+)\s+(\S+)", before)
        require(len(displays) == 1, "DPI fixture requires one actual virtual output")
        output_id = displays[0][0]
        original_scale = re.search(r"Scale:\s+([0-9.]+)", before).group(1)
        original_mode = re.search(r"(\d+):[^\s]*\*", before).group(1)
        require("1920x1440@60" in before, "Virtual output lacks the DPI fixture mode")
        guest(f"env-run kscreen-doctor output.{output_id}.mode.1920x1440@60")
        fixture = "VM DPI copy fixture"
        observations = []
        try:
            for scale in (1, 1.5, 2):
                guest(f"env-run kscreen-doctor output.{output_id}.scale.{scale}")
                wait_for(
                    "actual output scale",
                    lambda scale=scale: (
                        float(re.search(r"Scale:\s+([0-9.]+)", output()).group(1))
                        == scale
                    ),
                )
                guest(
                    f"env-run {prefix}/tyco-ctl open editor --text "
                    + shlex.quote(fixture)
                )
                driver.window("main", ".cm-editor")
                geometry = driver.execute(
                    "const b=document.querySelector('button[aria-label=Copy]'); if (!b) return null; const r=b.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,pixelRatio:devicePixelRatio};"
                )
                require(geometry is not None, "Editor copy action is missing")
                require(
                    geometry["width"] > 0
                    and geometry["height"] > 0
                    and 0 <= geometry["x"]
                    and geometry["x"] + geometry["width"] <= geometry["viewportWidth"]
                    and 0 <= geometry["y"]
                    and geometry["y"] + geometry["height"]
                    <= geometry["viewportHeight"],
                    f"Copy action is unreachable at scale {scale}: {geometry}",
                )
                element = driver.call(
                    "POST",
                    "/element",
                    {"using": "css selector", "value": "button[aria-label=Copy]"},
                )
                element_id = element["element-6066-11e4-a52e-4f735466cecf"]
                driver.call("POST", f"/element/{element_id}/click", {})
                wait_for(
                    "native clipboard after visible copy action",
                    lambda: guest("env-run wl-paste --no-newline") == fixture,
                )
                observations.append(
                    {"scale": scale, "geometry": geometry, "output": output()}
                )
                vm.qmp.screenshot(vm.run_dir / f"dpi-{scale}.png")
        finally:
            guest(
                f"env-run kscreen-doctor output.{output_id}.mode.{original_mode} output.{output_id}.scale.{original_scale}"
            )
        report["dpiObservations"] = observations
        return "Actual KScreen 100/150/200 percent scaling at 1920x1440; visible Copy control clicked through WebDriver and exact native clipboard verified; original mode/scale restored"

    def tray():
        nonlocal main_handle
        guest(f"env-run {prefix}/tyco-ctl open editor")
        driver.window("main", ".cm-editor")
        main = window_for(
            lambda window: (
                window["resourceClass"] == "tyco"
                and "TyCo" in window["title"]
                and window["normalWindow"]
            )
        )
        focus(main)
        vm.qmp.tap("alt", "f4")
        wait_for(
            "native main close hides the application",
            lambda: not driver.invoke("get_desktop_state")["window"]["isWindowShown"],
        )
        require(
            vm.ssh("pgrep -xc tyco").strip() == "1",
            "Closing main unexpectedly exited Tyco",
        )
        entries = json.loads(
            guest(
                "env-run busctl --user --json=short get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems"
            )
        )["data"]
        item = next(
            (
                item
                for item in entries
                if item.endswith(
                    "/org/ayatana/NotificationItem/tray_icon_tray_app_main_tray"
                )
            ),
            None,
        )
        require(
            item is not None,
            "Tyco is not registered with the native StatusNotifierWatcher",
        )
        service, path = item.split("/", 1)
        path = "/" + path
        menu = json.loads(
            guest(
                f"env-run busctl --user --json=short get-property {service} {path} org.kde.StatusNotifierItem Menu"
            )
        )["data"]
        layout = json.loads(
            guest(
                f"env-run busctl --user --json=short call -- {service} {menu} com.canonical.dbusmenu GetLayout iias 0 -1 0"
            )
        )
        items = {}

        def visit(value):
            if isinstance(value, list):
                if (
                    len(value) >= 2
                    and isinstance(value[0], int)
                    and isinstance(value[1], dict)
                ):
                    label = value[1].get("label", {})
                    if isinstance(label, dict):
                        label = label.get("data", "")
                    if label:
                        items[str(label).replace("&", "").lower()] = value[0]
                for child in value:
                    visit(child)
            elif isinstance(value, dict):
                for child in value.values():
                    visit(child)

        visit(layout)
        show = next(
            (value for label, value in items.items() if label.startswith("show")), None
        )
        quit_item = next(
            (value for label, value in items.items() if label.startswith("quit")), None
        )
        require(
            show is not None and quit_item is not None,
            f"Native tray menu lacks actions: {items}",
        )
        guest(
            f"env-run busctl --user call {service} {menu} com.canonical.dbusmenu Event isvu {show} clicked i 0 0"
        )
        wait_for(
            "native tray Show action",
            lambda: driver.invoke("get_desktop_state")["window"]["isWindowShown"],
        )
        report["nativeTrayMenu"] = layout
        vm.qmp.screenshot(vm.run_dir / "tray-show.png")
        guest(
            f"env-run busctl --user call {service} {menu} com.canonical.dbusmenu Event isvu {quit_item} clicked i 0 0"
        )
        wait_for(
            "native tray Quit exits application",
            lambda: vm.ssh("pgrep -xc tyco || true").strip() == "0",
        )
        try:
            driver.stop()
        except (StepFailed, OSError):
            pass
        application = prefix + (
            "/Tyco.AppImage" if args.artifact.suffix == ".AppImage" else "/tyco"
        )
        driver.start(application)
        main_handle = driver.call("GET", "/window")
        return "Native main close hid Tyco without exiting; actual StatusNotifierItem/DBusMenu Show reopened it and Quit terminated it; application restarted"

    from wallet import WalletFixture

    wallet = WalletFixture(guest)
    secret_alias = wallet.collection
    native_action = wallet.native_action
    provision_wallet = wallet.provision

    def secret_lifecycle():
        driver.window("main", ".cm-editor")
        provision_wallet()
        identifier = "vm.fixture"
        value = "tyco-vm-disposable-secret-83b1c9"
        driver.invoke(
            "set_secret",
            {
                "id": identifier,
                "value": value,
                "origins": ["https://vm-fixture.invalid"],
            },
        )
        status = driver.invoke("get_secret_statuses")
        require(
            status.get(identifier, {}).get("available"), "Stored secret is unavailable"
        )
        # Read through the real Secret Service CLI, independently of Tyco.
        retrieved = guest(
            f"env-run secret-tool lookup service com.tyco.app username {identifier}"
        ).strip()
        require(
            retrieved == value, "System Secret Service did not persist the exact value"
        )
        status_json = json.dumps(status)
        require(
            value not in status_json,
            "Raw secret escaped through the webview status response",
        )
        script = (
            "from pathlib import Path; needle="
            + repr(value)
            + "; roots=[Path.home()/'.config/com.tyco.app',Path.home()/'.local/state/com.tyco.app']; hits=[str(p) for root in roots for p in root.rglob('*') if p.is_file() and needle.encode() in p.read_bytes()]; print(hits)"
        )
        require(
            guest("env-run python3 -c " + shlex.quote(script)).strip() == "[]",
            "Raw secret leaked into config or logs",
        )
        driver.invoke("delete_secret", {"id": identifier})
        require(
            identifier not in driver.invoke("get_secret_statuses"),
            "Deleted secret is still exposed in status",
        )
        result = vm.ssh(
            f"python3 tyco-vm/guest.py env-run -- secret-tool lookup service com.tyco.app username {identifier}; test $? -ne 0"
        )
        require(not result.strip(), "Deleted secret remains in the system store")
        return "Actual Secret Service save/read/delete; exact value verified outside Tyco; no raw config/log/status leak"

    def locked_wallet():
        driver.window("main", ".cm-editor")
        provision_wallet()
        collection = secret_alias()

        def is_locked():
            return (
                json.loads(
                    guest(
                        f"env-run busctl --user --json=short get-property org.freedesktop.secrets {collection} org.freedesktop.Secret.Collection Locked"
                    )
                )["data"]
                is True
            )

        def unlock():
            if not is_locked():
                return
            result = json.loads(
                guest(
                    f"env-run busctl --user --json=short call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service Unlock ao 1 {collection}"
                )
            )["data"]
            if result[1] != "/":
                guest(
                    f"env-run busctl --user call org.freedesktop.secrets {result[1]} org.freedesktop.Secret.Prompt Prompt s ''"
                )
                native_action("fill-passwords", "TycoVmWalletFixture83")
                nodes = json.loads(
                    guest("env-run python3 tyco-vm/native-ui.py --application ksecretd")
                )
                buttons = [
                    node["name"]
                    for node in nodes
                    if node.get("showing")
                    and node.get("role") in ("button", "push button")
                    and node.get("name") in ("OK", "Open", "Unlock")
                ]
                require(
                    len(buttons) == 1,
                    f"Ambiguous native wallet unlock action: {buttons}",
                )
                native_action("click", buttons[0])
            wait_for(
                "native KWallet unlocked after authentication",
                lambda: not is_locked(),
                timeout=15,
            )

        guest(
            f"env-run busctl --user call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service Lock ao 1 {collection}"
        )
        wait_for("actual locked native collection", is_locked, timeout=10)
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(
            driver.invoke_result,
            "set_secret",
            {
                "id": "vm.locked.fixture",
                "value": "disposable-locked-wallet-fixture",
                "origins": ["https://vm-fixture.invalid"],
            },
        )
        try:
            native_action("click", "Cancel")
            result = future.result(timeout=15)
            require(
                not result["ok"],
                "Refused native wallet unlock was reported as successful storage",
            )
            require(
                is_locked(),
                "Canceled wallet unlock unexpectedly unlocked the collection",
            )
            report["lockedWalletError"] = result.get("error")
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
            unlock()
        recovered = secret_lifecycle()
        return (
            "Actual native collection locked; real unlock prompt canceled; secret write rejected and collection stayed locked; authenticated unlock restored storage: "
            + recovered
        )

    def unavailable_wallet():
        nonlocal main_handle
        driver.window("main", ".cm-editor")
        provision_wallet()
        collection = secret_alias()
        policy_path = "/etc/dbus-1/session.d/99-tyco-vm-secrets-denied.conf"
        vm.ssh("test ! -e " + policy_path)
        policy = vm.run_dir / "secrets-denied.conf"
        policy.write_text(
            '<busconfig><policy context="default"><deny send_destination="org.freedesktop.secrets"/></policy></busconfig>'
        )
        vm.copy_to(policy, "tyco-vm/secrets-denied.conf")
        application = prefix + (
            "/Tyco.AppImage" if args.artifact.suffix == ".AppImage" else "/tyco"
        )

        def reload_policy():
            guest(
                "env-run busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig"
            )

        def restart():
            nonlocal main_handle
            try:
                driver.stop()
            except (StepFailed, OSError):
                pass
            driver.start(application)
            main_handle = driver.call("GET", "/window")

        try:
            vm.ssh("sudo install -m 644 tyco-vm/secrets-denied.conf " + policy_path)
            reload_policy()
            probe_code = (
                "import json,subprocess; p=subprocess.run(['busctl','--user','get-property','org.freedesktop.secrets',"
                + repr(collection)
                + ",'org.freedesktop.Secret.Collection','Locked'],capture_output=True,text=True); print(json.dumps({'exit':p.returncode,'stderr':p.stderr}))"
            )
            probe = json.loads(guest("env-run python3 -c " + shlex.quote(probe_code)))
            require(
                probe["exit"] != 0 and "denied" in probe["stderr"].lower(),
                f"Real D-Bus policy did not deny vault access: {probe}",
            )
            restart()
            result = driver.invoke_result(
                "set_secret",
                {
                    "id": "vm.unavailable.fixture",
                    "value": "disposable-unavailable-vault-fixture",
                    "origins": ["https://vm-fixture.invalid"],
                },
            )
            require(
                not result["ok"] and bool(result.get("error")),
                "Unavailable native vault reported successful storage",
            )
            statuses = driver.invoke("get_secret_statuses")
            require(
                not statuses.get("vm.unavailable.fixture", {}).get("available"),
                "Failed native write was advertised as available",
            )
            report["unavailableWallet"] = {
                "independentDenial": probe,
                "applicationError": result.get("error"),
            }
        finally:
            vm.ssh("sudo rm -f " + policy_path)
            reload_policy()
            restart()
        recovered = secret_lifecycle()
        return (
            "Actual session-bus policy denied Secret Service access; independent native call and restarted Tyco both failed explicitly; policy removal and native storage recovery verified: "
            + recovered
        )

    from drag import run_file_drop

    run_file_drop(
        vm=vm,
        driver=driver,
        guest=guest,
        args=args,
        check=check,
        selected=selected,
        report=report,
        window_for=window_for,
        focus=focus,
        start=start,
    )

    for identifier, function in (
        ("VM-04.kate", kate),
        ("VM-04.browser-selection", browser),
        ("VM-08.konsole", terminal),
        ("VM-14.dialog-cancel", file_dialog_cancel),
        ("VM-14.directory-select", directory_select),
        ("VM-14.plugin-lifecycle", plugin_lifecycle),
        ("VM-12.secret-lifecycle", secret_lifecycle),
        ("VM-12.locked-wallet", locked_wallet),
        ("VM-12.unavailable-wallet", unavailable_wallet),
        ("VM-11.tray-show-quit", tray),
        ("VM-11.dpi", dpi),
        ("VM-11.multi-monitor", multi_monitor),
    ):
        if selected(identifier):
            check(identifier, function)

    return main_handle
