"""GNOME acceptance with independent receiver observations and explicit gaps."""

import base64
import hashlib
import json
import shlex
import uuid
import traceback

from vmlib import StepFailed, wait_for


def run_scenarios(vm, driver, args, guest, record, report, **_controls):
    def check(identifier, action):
        try:
            record(identifier, "PASS", action())
        except Exception as error:
            record(identifier, "FAIL", str(error))
            (vm.run_dir / f"{identifier}-exception.txt").write_text(
                traceback.format_exc()
            )
            vm.qmp.screenshot(vm.run_dir / f"{identifier}.png")
            try:
                diagnostics = driver.execute(
                    "return {keys:window.vmKeyEvents, focused:document.hasFocus(), activeElement:document.activeElement?.tagName, body:document.body.innerText.slice(0,6000)}"
                )
                (vm.run_dir / f"{identifier}-webview.json").write_text(
                    json.dumps(diagnostics, indent=2)
                )
            except Exception:
                pass

    def require(condition, message):
        if not condition:
            raise StepFailed(message)

    def startup():
        state = driver.invoke("get_desktop_state")
        report["initialState"] = state
        require(
            state["settings"]["userConfig"]["language"]["ui"] == "en-US",
            "Fixture config was not loaded",
        )
        require(
            driver.execute("return Boolean(document.querySelector('.cm-editor'))"),
            "Editor is missing",
        )
        return "Embedded editor opened in the real GNOME Wayland session"

    def degradation():
        status = driver.invoke("get_text_insertion_status")
        report["textInsertion"] = status
        require(
            status["target"] == "focusReturn",
            f"GNOME must report untracked focus return: {status}",
        )
        require(status["keys"] == "ready", f"Input fixture is not usable: {status}")
        return "GNOME reports focusReturn rather than claiming native target tracking; keyboard sender ready"

    def persistence():
        state = driver.invoke("get_desktop_state")
        config = json.loads(json.dumps(state["settings"]["userConfig"]))
        config["appearance"]["theme"] = "dark"
        driver.invoke(
            "save_user_config",
            {"baseConfig": state["settings"]["userConfig"], "userConfig": config},
        )
        identifier = driver.invoke(
            "add_editor_history_item",
            {
                "entry": {
                    "text": "GNOME persistence fixture",
                    "kind": "source",
                    "operation": "aiTask",
                }
            },
        )
        report["historyId"] = identifier
        driver.stop()
        wait_for(
            "previous native process exit",
            lambda: not vm.ssh("pgrep -x tyco || true").strip(),
        )
        driver.start(
            f"/home/{vm.user}/tyco-vm/"
            + ("Tyco.AppImage" if args.artifact.suffix == ".AppImage" else "tyco")
        )
        restored = driver.invoke("get_desktop_state")
        require(
            restored["settings"]["userConfig"]["appearance"]["theme"] == "dark",
            "Theme was lost after restart",
        )
        history = driver.invoke("get_editor_history")
        report["restoredHistory"] = history
        require(
            "GNOME persistence fixture" in json.dumps(history),
            "History was lost after restart",
        )
        return "Theme and editor history survived a native process restart"

    def secrets():
        driver.window("main", ".cm-editor")
        alias_command = "env-run busctl --user --json=short call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service ReadAlias s default"
        if json.loads(guest(alias_command))["data"][0] == "/":
            guest(
                f"env-run systemd-run --user --quiet --collect --unit=tyco-vm-keyring-collection --property=StandardOutput=append:/home/{vm.user}/tyco-vm/keyring-collection.log --property=StandardError=append:/home/{vm.user}/tyco-vm/keyring-collection.log python3 /home/{vm.user}/tyco-vm/secret-collection.py"
            )

            def password_prompt():
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                return (
                    nodes
                    if any(
                        node["role"] == "password text" and node.get("showing")
                        for node in nodes
                    )
                    else None
                )

            nodes = wait_for(
                "native GNOME keyring password prompt", password_prompt, timeout=30
            )
            (vm.run_dir / "gnome-keyring-prompt.json").write_text(
                json.dumps(nodes, indent=2)
            )
            vm.qmp.screenshot(vm.run_dir / "gnome-keyring-prompt.png")
            applications = {
                node["application"]
                for node in nodes
                if node["role"] == "password text" and node.get("showing")
            }
            require(
                len(applications) == 1,
                f"Ambiguous keyring prompt applications: {applications}",
            )
            application = applications.pop()
            guest(
                "env-run python3 tyco-vm/native-control.py fill-passwords "
                + shlex.quote(application)
                + " TycoVmGnomeCollection83"
            )
            buttons = [
                node["name"]
                for node in nodes
                if node["application"] == application
                and node["role"] in ("button", "push button")
                and node.get("showing")
                and node["name"] in ("Continue", "Create")
            ]
            require(
                len(buttons) == 1,
                f"Ambiguous native collection confirmation: {buttons}",
            )
            vm.qmp.tap("ret")

            def confirmation_focused():
                nodes = json.loads(
                    guest(
                        "env-run python3 tyco-vm/native-ui.py --application gnome-shell"
                    )
                )
                fields = [
                    node
                    for node in nodes
                    if node["role"] == "password text" and node.get("showing")
                ]
                return len(fields) == 2 and fields[1].get("focused")

            wait_for(
                "native keyring confirmation field focus",
                confirmation_focused,
                timeout=10,
            )
            vm.qmp.tap("ret")
            wait_for(
                "default GNOME keyring collection",
                lambda: json.loads(guest(alias_command))["data"][0] != "/",
            )
        identifier = "vm-gnome-secret-fixture"
        value = "TycoVmGnomeSecretFixture83"
        require(
            driver.invoke("get_secret_vault_state") == "available",
            "GNOME Keyring is not available",
        )
        driver.invoke(
            "set_secret",
            {
                "id": identifier,
                "value": value,
                "origins": ["https://vm-fixture.invalid"],
            },
        )
        try:
            status = driver.invoke("get_secret_statuses")
            require(
                status.get(identifier, {}).get("available"),
                "Saved secret is not available",
            )
            require(value not in json.dumps(status), "Raw secret leaked through status")
            observed = json.loads(
                guest(f"env-run python3 tyco-vm/secret-read.py {identifier}")
            )
            report["nativeSecret"] = observed
            require(
                len(observed["items"]) == 1
                and observed["items"][0]["sha256"]
                == hashlib.sha256(value.encode()).hexdigest(),
                "Native GNOME Keyring bytes differ",
            )
            script = (
                "from pathlib import Path; needle="
                + repr(value)
                + "; roots=[Path.home()/'.config/com.tyco.app',Path.home()/'.local/state/com.tyco.app']; print([str(p) for root in roots for p in root.rglob('*') if p.is_file() and needle.encode() in p.read_bytes()])"
            )
            require(
                guest("env-run python3 -c " + shlex.quote(script)).strip() == "[]",
                "Raw secret leaked into config or logs",
            )
        finally:
            driver.invoke("delete_secret", {"id": identifier})
        observed = json.loads(
            guest(f"env-run python3 tyco-vm/secret-read.py {identifier}")
        )
        require(
            not observed["items"] and not observed["lockedItems"],
            "Deleted secret remains in native keyring",
        )
        return "GNOME Keyring save/read/delete; independent native byte hash; no raw secret in status/config/logs"

    def external_control():
        require(args.ctl is not None, "--ctl is required")
        prefix = f"/home/{vm.user}/tyco-vm"
        status = json.loads(guest(f"env-run {prefix}/tyco-ctl status"))
        require(status["apiVersion"] == 2, f"Unexpected external API: {status}")
        denied = vm.ssh(
            f"python3 tyco-vm/guest.py env-run -- {prefix}/tyco-ctl open editor --selection --json 2>tyco-vm/selection-denied.json; test $? -eq 3 && cat tyco-vm/selection-denied.json"
        )
        require(
            json.loads(denied)["code"] == "AccessDenied",
            f"Selection was not denied: {denied}",
        )
        guest(
            "env-run busctl --user call org.tyco.Service /org/tyco/Object org.tyco.Interface OpenWithText ss editor gnome-dbus-fixture"
        )
        driver.window("main", ".cm-editor")
        wait_for(
            "D-Bus editor activation",
            lambda: driver.execute(
                "return document.querySelector('.cm-content')?.textContent.includes('gnome-dbus-fixture')"
            ),
        )
        return "Real CLI status and session D-Bus activation; selection access denied by default"

    def hotkeys():
        application = "gnome-control-center-global-shortcuts-provider"
        nodes = json.loads(
            guest(f"env-run python3 tyco-vm/native-ui.py --application {application}")
        )
        (vm.run_dir / "gnome-shortcuts-before.json").write_text(
            json.dumps(nodes, indent=2)
        )
        vm.qmp.screenshot(vm.run_dir / "gnome-shortcuts-before.png")
        guest(f"env-run python3 tyco-vm/native-control.py click {application} Add")
        driver.window("main", ".cm-editor")
        info = driver.invoke("get_hotkey_provider_info")
        report["hotkeys"] = info
        require(
            info["provider"] == "portal" and info["registered"],
            f"GNOME shortcuts not registered: {info}",
        )
        guest("receiver wayland")

        def receiver():
            try:
                return json.loads(vm.ssh("cat tyco-vm/receiver-wayland.json"))
            except StepFailed:
                return {}

        wait_for("hotkey receiver startup", lambda: receiver().get("pid"))
        if not receiver().get("focused"):
            vm.qmp.tap("alt", "tab")
        wait_for(
            "foreign focus before physical hotkey", lambda: receiver().get("focused")
        )
        before = driver.invoke("get_desktop_state")["activation"]["activationId"]
        activations = []
        for cycle in range(args.cycles):
            vm.qmp.tap("ctrl", "alt", "i")
            driver.window("quick", "textarea")
            wait_for(
                "quick native keyboard focus",
                lambda: driver.invoke("plugin:window|is_focused", {"label": "quick"})
                and driver.execute(
                    "return document.hasFocus() && document.activeElement === document.querySelector('textarea')"
                ),
            )
            after = driver.invoke("get_desktop_state")["activation"]["activationId"]
            require(
                after == before + 1,
                f"Expected one physical hotkey activation: {before} -> {after}",
            )
            driver.execute(
                "if (!window.vmKeyEvents) { window.vmKeyEvents = []; for (const type of ['keydown','keyup']) window.addEventListener(type, event => { const item = {type, key:event.key, repeat:event.repeat, time:performance.now()}; queueMicrotask(() => { item.prevented = event.defaultPrevented; window.vmKeyEvents.push(item); }); }, true); }"
            )
            vm.qmp.tap("esc")
            wait_for(
                "native receiver focus after dismissal",
                lambda: receiver().get("focused"),
            )
            activations.append(
                {
                    "cycle": cycle,
                    "activationId": after,
                    "receiverFocused": receiver()["focused"],
                }
            )
            (vm.run_dir / "gnome-hotkey-cycles.json").write_text(
                json.dumps(activations, indent=2)
            )
            before = after
        vm.qmp.tap("a")
        wait_for(
            "released modifiers after physical hotkey cycles",
            lambda: receiver().get("text") == "a",
        )
        vm.ssh(f"kill {receiver()['pid']}")
        driver.window("main", ".cm-editor")
        return f"Native GNOME GlobalShortcuts approval; {args.cycles} physical Ctrl+Alt+I activations from a foreign Wayland receiver, exact activation increments, focus return and released modifiers"

    def insertion(native_command=False):
        from scenarios import CORPUS

        prefix = f"/home/{vm.user}/tyco-vm"
        evidence = []
        for backend in ("wayland", "x11"):
            guest(f"receiver {backend}")

            def receiver():
                try:
                    return json.loads(vm.ssh(f"cat tyco-vm/receiver-{backend}.json"))
                except StepFailed:
                    return {}

            wait_for("native receiver startup", lambda: receiver().get("pid"))
            if not receiver().get("focused"):
                vm.qmp.tap("alt", "tab")
            wait_for("native receiver focus", lambda: receiver().get("focused"))
            for cycle in range(args.cycles):
                text = CORPUS[cycle % len(CORPUS)]
                identifier = uuid.uuid4().hex
                payload = json.dumps({"id": identifier, "action": "reset", "text": ""})
                vm.ssh(
                    f"printf %s {shlex.quote(payload)} > tyco-vm/receiver-{backend}.command.json.tmp && mv tyco-vm/receiver-{backend}.command.json.tmp tyco-vm/receiver-{backend}.command.json"
                )
                wait_for(
                    "receiver reset",
                    lambda: vm.ssh(
                        f"cat tyco-vm/receiver-{backend}.ack 2>/dev/null || true"
                    ).strip()
                    == identifier,
                )
                require(receiver()["focused"], "Receiver lost focus before activation")
                guest(f"env-run {prefix}/tyco-ctl open quick-input")
                driver.window("quick", "textarea")
                wait_for(
                    "native Quick focus before insertion",
                    lambda: driver.invoke(
                        "plugin:window|is_focused", {"label": "quick"}
                    )
                    and driver.execute(
                        "return document.hasFocus() && document.activeElement === document.querySelector('textarea')"
                    ),
                    timeout=20,
                )
                if native_command:
                    activation_id = driver.invoke("get_desktop_state")["activation"][
                        "activationId"
                    ]
                    driver.invoke(
                        "paste_into_target_and_hide",
                        {"activationId": activation_id, "text": text},
                    )
                else:
                    points = driver.execute(
                        "const input = document.querySelector('textarea'); const text = new TextDecoder().decode(Uint8Array.from(atob(arguments[0]), c => c.charCodeAt(0))); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text); input.dispatchEvent(new Event('input', {bubbles:true})); return Array.from(input.value, c => c.codePointAt(0));",
                        [base64.b64encode(text.encode()).decode()],
                    )
                    require(
                        points == [ord(character) for character in text],
                        "UI fixture lost Unicode code points",
                    )
                    driver.text("textarea", "\ue004")
                    wait_for(
                        "insert button",
                        lambda: driver.execute(
                            "return [...document.querySelectorAll('button')].some(b => b.textContent.includes('Insert into window'))"
                        ),
                    )
                    wait_for(
                        "native action-menu focus",
                        lambda: driver.invoke(
                            "plugin:window|is_focused", {"label": "quick"}
                        )
                        and driver.execute("return document.hasFocus()"),
                        timeout=20,
                    )
                    enabled = driver.execute(
                        "return [...document.querySelectorAll('button')].some(b => b.textContent.includes('Insert into window') && !b.disabled)"
                    )
                    require(
                        enabled,
                        "Insert into window is disabled despite ready focusReturn backend (GNOME has no windowId)",
                    )
                    driver.execute(
                        "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Insert into window') && !b.disabled).click()"
                    )
                wait_for(
                    "exact foreign text and returned focus",
                    lambda: receiver().get("text") == text
                    and receiver().get("focused"),
                )
                observed = receiver()
                evidence.append(
                    {
                        "backend": backend,
                        "cycle": cycle,
                        "text": observed["text"],
                        "focused": observed["focused"],
                        "keys": observed["keys"],
                    }
                )
                (
                    vm.run_dir
                    / (
                        "gnome-backend-insertion.json"
                        if native_command
                        else "gnome-insertion.json"
                    )
                ).write_text(json.dumps(evidence, indent=2))
            vm.ssh(f"kill {receiver()['pid']}")
            driver.window("main", ".cm-editor")
        return f"Exact Unicode/multiline/long text and focus return in {args.cycles} CLI activations per Wayland/XWayland receiver; hotkeys tested separately"

    checks = [
        ("VM-01.startup", startup),
        ("VM-10.capabilities", degradation),
        ("VM-01.persistence", persistence),
        ("VM-10.insertion", insertion),
        ("VM-10.backend-insertion", lambda: insertion(True)),
        ("VM-02.register", hotkeys),
        ("VM-13.external-control", external_control),
        ("VM-12.secrets", secrets),
    ]
    for identifier, action in checks:
        if not args.only or any(
            identifier == request or identifier.startswith(request + ".")
            for request in args.only.split(",")
        ):
            check(identifier, action)
    if args.suite == "native":
        from importlib import import_module
        from media import run_media_checks

        def selected(identifier):
            return not args.only or any(
                identifier == request or identifier.startswith(request + ".")
                for request in args.only.split(",")
            )

        import_module("command-grants").run_command_grant_checks(
            vm=vm, driver=driver, guest=guest, check=check, selected=selected, args=args
        )
        run_media_checks(
            vm=vm,
            driver=driver,
            guest=guest,
            check=check,
            selected=selected,
            report=report,
        )
    if not args.only:
        if args.suite == "native":
            record(
                "GNOME.native",
                "BLOCKED",
                "Remaining applicable native cases require GNOME-specific controls; KDE checks are not substituted",
            )
