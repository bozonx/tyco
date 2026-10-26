"""GNOME AppIndicator integration and recovery when the extension is absent."""

from importlib import import_module
import json
import shlex

from vmlib import StepFailed, wait_for


def run_checks(*, vm, driver, args, guest, check, selected, report):
    if not selected("VM-11.tray-show-quit"):
        return
    prefix = f"/home/{vm.user}/tyco-vm"
    application = prefix + (
        "/Tyco.AppImage" if args.artifact.suffix == ".AppImage" else "/tyco"
    )

    def require(condition, message):
        if not condition:
            raise StepFailed(message)

    def open_main():
        guest(f"env-run {prefix}/tyco-ctl open editor")
        driver.window("main", ".cm-editor")
        wait_for(
            "main webview native focus",
            lambda: driver.execute("return document.hasFocus()"),
        )

    def hide_main():
        open_main()
        vm.qmp.tap("alt", "f4")
        wait_for(
            "native main close hides rather than exits",
            lambda: not driver.invoke("get_desktop_state")["window"]["isWindowShown"],
        )
        require(vm.ssh("pgrep -xc tyco").strip() == "1", "Closing main terminated Tyco")

    def scenario():
        installed = guest("env-run gnome-extensions list").splitlines()
        enabled = guest("env-run gnome-extensions list --enabled").splitlines()
        report["gnomeExtensions"] = {"installed": installed, "enabled": enabled}
        indicators = [
            extension for extension in installed if "appindicator" in extension.lower()
        ]
        require(
            len(indicators) == 1,
            f"Expected the Ubuntu AppIndicator extension: {installed}",
        )
        extension = indicators[0]
        import_module("gnome-setup").ensure_shortcuts(driver, guest)
        try:
            guest("env-run gnome-extensions disable " + shlex.quote(extension))
            wait_for(
                "AppIndicator disabled",
                lambda: (
                    extension
                    not in guest("env-run gnome-extensions list --enabled").splitlines()
                ),
            )
            hide_main()
            open_main()
            guest("env-run gnome-extensions enable " + shlex.quote(extension))
            wait_for(
                "AppIndicator enabled",
                lambda: (
                    extension
                    in guest("env-run gnome-extensions list --enabled").splitlines()
                ),
            )
            hide_main()

            def entry():
                data = json.loads(
                    guest(
                        "env-run busctl --user --json=short get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems"
                    )
                )["data"]
                matches = [
                    item
                    for item in data
                    if item.endswith(
                        "/org/ayatana/NotificationItem/tray_icon_tray_app_main_tray"
                    )
                ]
                return matches[0] if len(matches) == 1 else None

            item = wait_for("Tyco registered with GNOME's native tray host", entry)
            service, path = item.split("/", 1)
            service = service.removesuffix("@")
            menu = json.loads(
                guest(
                    f"env-run busctl --user --json=short get-property {service} /{path} org.kde.StatusNotifierItem Menu"
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
                (value for label, value in items.items() if label.startswith("show")),
                None,
            )
            quit_item = next(
                (value for label, value in items.items() if label.startswith("quit")),
                None,
            )
            require(
                show is not None and quit_item is not None,
                f"Native tray menu missing actions: {items}",
            )
            guest(
                f"env-run busctl --user call {service} {menu} com.canonical.dbusmenu Event isvu {show} clicked i 0 0"
            )
            wait_for(
                "native tray Show",
                lambda: (
                    driver.invoke("get_desktop_state")["window"]["isWindowShown"]
                    and driver.execute("return document.hasFocus()")
                ),
            )
            guest(
                f"env-run busctl --user call {service} {menu} com.canonical.dbusmenu Event isvu {quit_item} clicked i 0 0"
            )
            wait_for(
                "native tray Quit",
                lambda: vm.ssh("pgrep -xc tyco || true").strip() == "0",
            )
            driver.stop()
            driver.start(application)
            report["gnomeNativeTray"] = layout
            return "Without AppIndicator, native close/CLI reopening remains usable; with it, native tray Show/Quit work and process restarts"
        finally:
            guest(
                "env-run gnome-extensions "
                + ("enable " if extension in enabled else "disable ")
                + shlex.quote(extension)
            )

    check("VM-11.tray-show-quit", scenario)
