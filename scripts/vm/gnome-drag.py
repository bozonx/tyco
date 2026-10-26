"""Real Nautilus/XWayland to Tyco/Wayland file drop in GNOME."""

from importlib import import_module
import json
import re
import shlex
import struct
import time

from vmlib import StepFailed, wait_for


def run_checks(*, vm, driver, args, guest, check, selected, report):
    if not selected("VM-14.file-drop"):
        return

    def require(condition, message):
        if not condition:
            raise StepFailed(message)

    def scenario():
        import_module("gnome-setup").ensure_shortcuts(driver, guest)
        prefix = f"/home/{vm.user}/tyco-vm"
        name = "drop note é.txt"
        path = prefix + "/TycoVmDrop/" + name
        sibling = prefix + "/TycoVmDrop/not-dropped.txt"
        contents = b"GNOME native file drop fixture\nSecond line\n"
        vm.ssh("mkdir -p tyco-vm/TycoVmDrop")
        local = vm.run_dir / name
        local.write_bytes(contents)
        vm.copy_to(local, "tyco-vm/TycoVmDrop/")
        vm.ssh("printf %s 'Protected sibling' > tyco-vm/TycoVmDrop/not-dropped.txt")
        guest(f"env-run {prefix}/tyco-ctl open chat")
        driver.window("main", ".chat-composer")
        wait_for(
            "main native focus before maximize",
            lambda: driver.execute("return document.hasFocus()"),
        )
        screenshot = vm.run_dir / "gnome-before-drop.png"
        vm.qmp.screenshot(screenshot)
        width, height = struct.unpack(">II", screenshot.read_bytes()[16:24])
        if driver.execute("return window.innerWidth") < width * 0.8:
            vm.qmp.tap("alt", "f10")
        wait_for(
            "native maximized chat viewport",
            lambda: driver.execute("return window.innerWidth") >= width * 0.8,
        )
        require(
            not driver.invoke_result("read_dropped_file", {"path": path})["ok"],
            "Fixture file readable before an actual drop",
        )
        zone = driver.execute(
            "const r=document.querySelector('.chat-composer').getBoundingClientRect(); return {iw:innerWidth,ih:innerHeight,x:r.x+r.width*.85,y:r.y+r.height/2};"
        )
        # A maximized regular GNOME window fills the work area to its bottom/right.
        destination_x = width - zone["iw"] + zone["x"]
        destination_y = height - zone["ih"] + zone["y"]
        for property_name in ("IsEnabled", "ScreenReaderEnabled"):
            guest(
                "env-run busctl --user set-property org.a11y.Bus /org/a11y/bus org.a11y.Status "
                + property_name
                + " b true"
            )
        guest(
            "env-run gsettings set org.gnome.nautilus.preferences default-folder-viewer icon-view"
        )
        guest(
            "env-run gsettings set org.gnome.nautilus.preferences default-sort-order name"
        )
        guest(
            "env-run gsettings set org.gnome.nautilus.preferences default-sort-in-reverse-order false"
        )
        vm.ssh("pkill -x nautilus || test $? -eq 1")
        wait_for(
            "previous Nautilus process exit before choosing XWayland",
            lambda: not vm.ssh("pgrep -x nautilus || true").strip(),
        )
        try:
            guest(
                f"env-run systemd-run --user --quiet --collect --unit=tyco-vm-gnome-drag --setenv=GDK_BACKEND=x11 --setenv=GTK_A11Y=atspi nautilus --new-window --select "
                + shlex.quote(path)
            )

            def manager():
                raw = guest(
                    "env-run sh -c 'xdotool search --onlyvisible --name TycoVmDrop || true'"
                ).split()
                return raw[0] if len(raw) == 1 else None

            window = wait_for("actual XWayland Nautilus window", manager, timeout=30)
            guest(
                f"env-run xdotool windowsize {window} 540 500 windowmove {window} 0 100 windowactivate --sync {window}"
            )
            geometry = dict(
                line.split("=", 1)
                for line in guest(
                    f"env-run xdotool getwindowgeometry --shell {window}"
                ).splitlines()
                if "=" in line
            )

            vm.qmp.screenshot(vm.run_dir / "gnome-file-manager.png")

            def item():
                nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
                (vm.run_dir / "gnome-file-manager-ui.json").write_text(
                    json.dumps(nodes, indent=2)
                )
                nodes = json.loads(
                    guest(
                        "env-run python3 tyco-vm/native-control.py locate-name org.gnome.Nautilus "
                        + shlex.quote(name)
                    )
                )
                return (
                    nodes[0] if len(nodes) == 1 and nodes[0]["bounds"][2] > 0 else None
                )

            try:
                source = wait_for("native Nautilus file item", item, timeout=6)
            except StepFailed:
                # GTK4 can expose only its frame through AT-SPI on XWayland.
                # The isolated directory is name-sorted with exactly two files;
                # --select identifies the first icon. Exact OS-granted bytes and
                # the visible attachment below still prove which file was dragged.
                extents = [
                    int(value)
                    for value in re.findall(
                        r"\d+",
                        guest(f"env-run xprop -id {window} _GTK_FRAME_EXTENTS"),
                    )
                ]
                require(
                    len(extents) == 4, f"Missing native GTK client extents: {extents}"
                )
                source = {
                    "mode": "fixed name-sorted fixture grid",
                    "gtkFrameExtents": extents,
                    "bounds": [extents[0] + 72, extents[2] + 130, 1, 1],
                    "frameBounds": [
                        0,
                        0,
                        int(geometry["WIDTH"]),
                        int(geometry["HEIGHT"]),
                    ],
                }
            bounds, frame = source["bounds"], source["frameBounds"]
            require(
                abs(int(geometry["WIDTH"]) - frame[2]) < 5,
                "Nautilus coordinate frame differs from the XWayland window",
            )
            source_x = int(geometry["X"]) + bounds[0] - frame[0] + bounds[2] / 2
            source_y = int(geometry["Y"]) + bounds[1] - frame[1] + bounds[3] / 2
            require(
                all(
                    0 <= x < width and 0 <= y < height
                    for x, y in ((source_x, source_y), (destination_x, destination_y))
                ),
                "Drop endpoints outside native display",
            )

            def move(x, y):
                vm.qmp.execute(
                    "input-send-event",
                    events=[
                        {
                            "type": "abs",
                            "data": {"axis": "x", "value": int(x * 32767 / width)},
                        },
                        {
                            "type": "abs",
                            "data": {"axis": "y", "value": int(y * 32767 / height)},
                        },
                    ],
                )

            vm.qmp.screenshot(screenshot)
            report["gnomeNativeDropSetup"] = {
                "source": source,
                "geometry": geometry,
                "target": zone,
                "sourcePoint": [source_x, source_y],
                "destinationPoint": [destination_x, destination_y],
            }
            (vm.run_dir / "gnome-drop-setup.json").write_text(
                json.dumps(report["gnomeNativeDropSetup"], indent=2)
            )
            move(source_x, source_y)
            time.sleep(0.12)
            try:
                vm.qmp.execute(
                    "input-send-event",
                    events=[{"type": "btn", "data": {"down": True, "button": "left"}}],
                )
                time.sleep(0.1)
                for step in range(1, 26):
                    fraction = step / 25
                    move(
                        source_x + (destination_x - source_x) * fraction,
                        source_y + (destination_y - source_y) * fraction,
                    )
                    time.sleep(0.03)
                time.sleep(0.12)
            finally:
                vm.qmp.execute(
                    "input-send-event",
                    events=[{"type": "btn", "data": {"down": False, "button": "left"}}],
                )

            time.sleep(0.12)
            vm.qmp.screenshot(vm.run_dir / "gnome-drop-released.png")

            def actual_bytes():
                result = driver.call(
                    "POST",
                    "/execute/async",
                    {
                        "script": "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('read_dropped_file',{path:arguments[0]}).then(buffer=>done({ok:true,bytes:Array.from(new Uint8Array(buffer))}),error=>done({ok:false,error}));",
                        "args": [path],
                    },
                )
                return result["ok"] and bytes(result["bytes"]) == contents

            wait_for(
                "GNOME drop grants exact native file bytes", actual_bytes, timeout=20
            )
            wait_for(
                "visible native dropped attachment",
                lambda: driver.execute(
                    "return document.querySelector('.context-list')?.textContent.includes(arguments[0])",
                    [name],
                ),
            )
            require(
                not driver.invoke_result("read_dropped_file", {"path": sibling})["ok"],
                "Drop authorized an undropped sibling",
            )
            report["gnomeNativeDrop"] = {
                "source": source,
                "geometry": geometry,
                "destination": zone,
                "path": path,
                "byteCount": len(contents),
            }
            vm.qmp.screenshot(vm.run_dir / "gnome-after-drop.png")
            return "Real Nautilus/XWayland file dragged by USB pointer into Tyco/Wayland; exact bytes and visible Unicode/spaced attachment; undropped sibling denied"
        finally:
            guest(
                "env-run sh -c 'if systemctl --user is-active --quiet tyco-vm-gnome-drag.service; then systemctl --user stop tyco-vm-gnome-drag.service; fi'"
            )
            guest(f"env-run {prefix}/tyco-ctl open editor")
            driver.window("main", ".cm-editor")

    check("VM-14.file-drop", scenario)
