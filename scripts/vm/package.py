"""Production AppImage desktop integration without WebDriver instrumentation."""

import json
import re
import shlex
import struct
import time

from vmlib import ROOT, StepFailed, sha256, wait_for


def validate_upgrade_versions(previous, current):
    def precedence(version):
        match = (
            re.fullmatch(
                r"(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?",
                version,
            )
            if isinstance(version, str)
            else None
        )
        if not match:
            raise StepFailed(
                "Both actual applications must report semantic release versions"
            )
        prerelease = match[4]
        identifiers = (
            tuple(
                (0, int(value)) if value.isdecimal() else (1, value)
                for value in prerelease.split(".")
            )
            if prerelease
            else ()
        )
        return tuple(int(match[index]) for index in (1, 2, 3)) + (
            int(prerelease is None),
            identifiers,
        )

    if precedence(previous) >= precedence(current):
        raise StepFailed(
            "Upgrade requires an older actual release version; reinstall/downgrade does not count"
        )


def run_package_checks(*, vm, args, guest, record, report, setup_observer):
    metadata_path = args.artifact.with_name(args.artifact.name + ".build.json")
    if not metadata_path.is_file():
        raise StepFailed(
            "Package acceptance requires the release .AppImage.build.json produced by build-appimage.py --release"
        )
    metadata = json.loads(metadata_path.read_text())
    if metadata.get("profile") != "release" or metadata.get("artifactSha256") != sha256(
        args.artifact
    ):
        raise StepFailed("Release build provenance does not match the package")
    if args.ctl is None:
        raise StepFailed("Package acceptance requires --ctl")
    current_version = json.loads((ROOT / "package.json").read_text())["version"]
    report["productionBuild"] = metadata
    prefix = f"/home/{vm.user}/tyco-vm"
    installed = f"/home/{vm.user}/.local/lib/tyco/Tyco.AppImage"
    config = json.loads(
        (ROOT / "packages/shared/src/user-config-defaults.json").read_text()
    )
    config["configVersion"] = json.loads(
        (ROOT / "packages/shared/src/config-version.json").read_text()
    )
    config["language"]["ui"] = "en-US"
    config["appearance"]["theme"] = "dark"
    config["hotkeys"] = dict.fromkeys(config["hotkeys"], "")
    for page in config["launcherPages"]:
        page["hotkey"] = ""
    fixture = vm.run_dir / "package-config.json"
    fixture.write_text(json.dumps(config))
    vm.ssh(
        "mkdir -p .config/com.tyco.app .local/lib/tyco .local/bin .local/share/applications .local/share/com.tyco.app"
    )
    if not args.previous_artifact:
        vm.copy_to(fixture, ".config/com.tyco.app/config.json")
    vm.ssh(
        "printf %s 'VM package user data fixture' > .local/share/com.tyco.app/vm-preserved.txt"
    )
    desktop = vm.run_dir / "com.tyco.app.desktop"
    desktop.write_text(
        f"[Desktop Entry]\nType=Application\nName=TyCo\nExec={installed} editor\nTerminal=false\nCategories=Utility;\n"
    )
    initial_artifact = (
        "Previous.AppImage" if args.previous_artifact else "Tyco.AppImage"
    )
    vm.ssh(
        f"cp tyco-vm/{initial_artifact} .local/lib/tyco/Tyco.AppImage && chmod 755 .local/lib/tyco/Tyco.AppImage && ln -s ../lib/tyco/Tyco.AppImage .local/bin/tyco"
    )
    vm.copy_to(desktop, ".local/share/applications/com.tyco.app.desktop")
    vm.ssh(
        "desktop-file-validate .local/share/applications/com.tyco.app.desktop && update-desktop-database .local/share/applications"
    )
    setup_observer()
    guest(
        "env-run busctl --user set-property org.a11y.Bus /org/a11y/bus org.a11y.Status IsEnabled b true"
    )
    guest(
        "env-run busctl --user set-property org.a11y.Bus /org/a11y/bus org.a11y.Status ScreenReaderEnabled b true"
    )

    def status():
        try:
            return json.loads(guest(f"env-run {prefix}/tyco-ctl status", timeout=10))
        except StepFailed:
            return None

    def launch():
        code = "import subprocess; log=open('tyco-vm/package-launch.log','ab'); p=subprocess.Popen(['env','QT_QUICK_BACKEND=software','LIBGL_ALWAYS_SOFTWARE=1','gtk-launch','com.tyco.app'],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True); print(p.pid)"
        guest("env-run python3 -c " + shlex.quote(code))
        info = wait_for("production CLI service", status, timeout=60)
        wait_for(
            "production native window",
            lambda: any(
                window["resourceClass"] == "tyco" and window["normalWindow"]
                for window in json.loads(vm.ssh("cat tyco-vm/windows.json"))["windows"]
            ),
            timeout=30,
        )
        return info

    def stop():
        items = json.loads(
            guest(
                "env-run busctl --user --json=short get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems"
            )
        )["data"]
        item = next(
            (
                item
                for item in items
                if item.endswith(
                    "/org/ayatana/NotificationItem/tray_icon_tray_app_main_tray"
                )
            ),
            None,
        )
        if item is None:
            raise StepFailed("Production application has no native tray item")
        service, path = item.split("/", 1)
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
        matches = []

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
                    if str(label).replace("&", "").lower().startswith("quit"):
                        matches.append(value[0])
                for child in value:
                    visit(child)
            elif isinstance(value, dict):
                for child in value.values():
                    visit(child)

        visit(layout)
        if len(matches) != 1:
            raise StepFailed("Production tray does not expose one Quit action")
        guest(
            f"env-run busctl --user call {service} {menu} com.canonical.dbusmenu Event isvu {matches[0]} clicked i 0 0"
        )
        wait_for(
            "production process exits",
            lambda: vm.ssh("pgrep -xc tyco || true").strip() == "0",
        )

    upgraded = False
    try:
        if args.previous_artifact:
            previous_status = launch()
            report["previousReleaseStatus"] = previous_status
            validate_upgrade_versions(previous_status.get("version"), current_version)
            stop()
            previous_config = json.loads(vm.ssh("cat .config/com.tyco.app/config.json"))
            previous_config["appearance"]["theme"] = "dark"
            previous_config["language"]["ui"] = "en-US"
            previous_config["hotkeys"] = dict.fromkeys(previous_config["hotkeys"], "")
            for page in previous_config["launcherPages"]:
                page["hotkey"] = ""
            saved = vm.run_dir / "previous-release-config.json"
            saved.write_text(json.dumps(previous_config))
            vm.copy_to(saved, ".config/com.tyco.app/config.json")
            vm.ssh(
                "cp tyco-vm/Tyco.AppImage .local/lib/tyco/Tyco.AppImage && chmod 755 .local/lib/tyco/Tyco.AppImage"
            )
            current_status = launch()
            if current_status.get("version") != current_version:
                raise StepFailed(
                    "Upgraded application does not report the current release version"
                )
            migrated = json.loads(vm.ssh("cat .config/com.tyco.app/config.json"))
            if (
                migrated["appearance"]["theme"] != "dark"
                or migrated["language"]["ui"] != "en-US"
                or vm.ssh("cat .local/share/com.tyco.app/vm-preserved.txt").strip()
                != "VM package user data fixture"
            ):
                raise StepFailed("Upgrade lost saved preferences or user data")
            report["upgradedReleaseStatus"] = current_status
            upgraded = True
            record(
                "VM-18.upgrade",
                "PASS",
                "Two distinct actual release versions launched; older application configuration migrated with retained preferences and user data",
            )
            stop()
        report["productionStatus"] = launch()
        if report["productionStatus"].get("version") != current_version:
            raise StepFailed(
                "Production artifact version does not match the current project version"
            )
        vm.qmp.screenshot(vm.run_dir / "production-installed.png")
        vm.ssh(
            "for pid in $(pgrep -x tyco); do cat /proc/$pid/maps; done > tyco-vm/production-app-maps.txt"
        )
        record(
            "VM-18.install-launch",
            "PASS",
            "Release AppImage installed with validated desktop entry and launcher symlink; actual desktop launch, native window, CLI and tray observed",
        )
        guest(
            f"env-run {prefix}/tyco-ctl open editor --text 'VM production package text'"
        )
        wait_for(
            "production editor has native focus",
            lambda: (
                lambda state: any(
                    window["id"] == state["activeWindowId"]
                    and window["resourceClass"] == "tyco"
                    for window in state["windows"]
                )
            )(json.loads(vm.ssh("cat tyco-vm/windows.json"))),
            timeout=20,
        )
        vm.ssh(
            "printf %s 'Unrelated clipboard sentinel' | python3 tyco-vm/guest.py env-run -- wl-copy --type text/plain > /dev/null 2>tyco-vm/package-clipboard.log"
        )
        state = json.loads(vm.ssh("cat tyco-vm/windows.json"))
        window = next(
            window
            for window in state["windows"]
            if window["id"] == state["activeWindowId"]
        )
        geometry = window["geometry"]
        image_width, image_height = struct.unpack(
            ">II", (vm.run_dir / "production-installed.png").read_bytes()[16:24]
        )
        x = int((geometry["x"] + geometry["width"] / 2) * 32767 / image_width)
        y = int((geometry["y"] + geometry["height"] / 2) * 32767 / image_height)
        try:
            vm.qmp.execute(
                "input-send-event",
                events=[
                    {"type": "abs", "data": {"axis": "x", "value": x}},
                    {"type": "abs", "data": {"axis": "y", "value": y}},
                    {"type": "btn", "data": {"down": True, "button": "left"}},
                ],
            )
            time.sleep(0.06)
        finally:
            vm.qmp.execute(
                "input-send-event",
                events=[{"type": "btn", "data": {"down": False, "button": "left"}}],
            )
            time.sleep(0.06)
        vm.qmp.tap("ctrl", "a")
        vm.qmp.tap("ctrl", "c")

        def copied_text():
            text = guest("env-run wl-paste --no-newline --type text/plain")
            report["productionCopiedText"] = text
            return text == "VM production package text"

        wait_for("exact production editor copy", copied_text, timeout=20)
        record(
            "VM-18.offline-ui",
            "PASS",
            "Real production editor focused independently; physical Select All/Copy returned exact CLI-delivered text through the native clipboard while external egress was blocked",
        )
        stop()
        before_reinstall = vm.ssh(
            "sha256sum .config/com.tyco.app/config.json .local/share/com.tyco.app/vm-preserved.txt"
        )
        vm.ssh(
            "cp tyco-vm/Tyco.AppImage .local/lib/tyco/Tyco.AppImage && chmod 755 .local/lib/tyco/Tyco.AppImage"
        )
        require_preserved = vm.ssh(
            "sha256sum .config/com.tyco.app/config.json .local/share/com.tyco.app/vm-preserved.txt"
        )
        if require_preserved != before_reinstall:
            raise StepFailed(
                "Same-version reinstall changed configuration or user data"
            )
        report["productionRestartStatus"] = launch()
        record(
            "VM-18.reinstall",
            "PASS",
            "Same release reinstalled and launched successfully; exact config/user-data hashes retained; this does not count as an upgrade",
        )
        if (
            vm.ssh("cat .local/share/com.tyco.app/vm-preserved.txt").strip()
            != "VM package user data fixture"
        ):
            raise StepFailed("Production restart lost user data")
        record(
            "VM-18.restart",
            "PASS",
            "Production tray Quit and desktop relaunch succeeded; user data retained",
        )
        stop()
        vm.ssh(
            "rm .local/share/applications/com.tyco.app.desktop .local/bin/tyco .local/lib/tyco/Tyco.AppImage && rmdir .local/lib/tyco && update-desktop-database .local/share/applications"
        )
        vm.ssh(
            "test ! -e .local/bin/tyco && test ! -e .local/share/applications/com.tyco.app.desktop && test -f .config/com.tyco.app/config.json && test -f .local/share/com.tyco.app/vm-preserved.txt"
        )
        record(
            "VM-18.uninstall",
            "PASS",
            "AppImage, launcher and desktop entry removed; application stopped and user data/config retained",
        )
    except Exception as error:
        record("VM-18.package", "FAIL", str(error))
    if not args.previous_artifact:
        record(
            "VM-18.upgrade",
            "BLOCKED",
            "A previous real release artifact is required; reinstalling the same version cannot validate migrations",
        )
    elif not upgraded:
        record(
            "VM-18.upgrade",
            "FAIL",
            "Upgrade did not complete; see package failure and previous release diagnostics",
        )
