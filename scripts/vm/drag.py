"""Real Dolphin-to-WebKit file drops through the virtual USB pointer."""

import json
import shlex
import struct
import time

from vmlib import StepFailed, wait_for


def run_file_drop(
    *, vm, driver, guest, args, check, selected, report, window_for, focus, start
):
    if not selected("VM-14.file-drop"):
        return

    def scenario():
        prefix = f"/home/{vm.user}/tyco-vm"
        name = "drop note \u00e9.txt"
        contents = b"VM native dropped file fixture\nSecond line\n"
        remote = prefix + "/TycoVmDrop/" + name
        sibling = prefix + "/TycoVmDrop/not-dropped.txt"
        vm.ssh("mkdir -p tyco-vm/TycoVmDrop")
        local = vm.run_dir / name
        local.write_bytes(contents)
        vm.copy_to(local, "tyco-vm/TycoVmDrop/")
        vm.ssh(
            "printf %s 'Protected sibling file' > tyco-vm/TycoVmDrop/not-dropped.txt"
        )
        started = False
        try:
            guest(f"env-run {prefix}/tyco-ctl open chat")
            driver.window("main", ".ai-chat")
            wait_for(
                "real chat composer accepts files",
                lambda: driver.execute(
                    "return Boolean(document.querySelector('.chat-composer'))"
                ),
                timeout=20,
            )
            before = driver.invoke_result("read_dropped_file", {"path": remote})
            if before["ok"]:
                raise StepFailed("A file was readable before an actual native drop")
            start("file-manager", ["dolphin", "--new-window", "--select", remote])
            started = True
            manager = window_for(
                lambda window: (
                    "dolphin" in window["resourceClass"].lower()
                    and "TycoVmDrop" in window["title"]
                )
            )
            main = window_for(
                lambda window: (
                    window["resourceClass"] == "tyco"
                    and window["normalWindow"]
                    and "TyCo" in window["title"]
                )
            )
            script = vm.run_dir / "position-drop.js"
            script.write_text(
                "const layouts="
                + json.dumps(
                    {
                        manager["id"]: {"x": 0, "y": 80, "width": 600, "height": 650},
                        main["id"]: {"x": 360, "y": 30, "width": 920, "height": 700},
                    }
                )
                + "; for(const w of workspace.windowList()){ if(layouts[w.internalId.toString()]) w.frameGeometry=layouts[w.internalId.toString()]; }"
            )
            vm.copy_to(script, "tyco-vm/position-drop.js")
            loaded = guest(
                f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss {prefix}/position-drop.js tyco-vm-position-drop"
            )
            guest(
                f"env-run busctl --user call org.kde.KWin /Scripting/Script{int(loaded.split()[-1])} org.kde.kwin.Script run"
            )
            focus(manager)

            def item_location():
                nodes = json.loads(
                    guest(
                        "env-run python3 tyco-vm/native-control.py locate-name dolphin "
                        + shlex.quote(name)
                    )
                )
                if len(nodes) != 1:
                    return None
                return (
                    nodes[0]
                    if nodes[0]["bounds"][2] > 0 and nodes[0]["bounds"][3] > 0
                    else None
                )

            item = wait_for("actual Dolphin file item", item_location, timeout=20)
            state = json.loads(vm.ssh("cat tyco-vm/windows.json"))
            manager = next(
                window for window in state["windows"] if window["id"] == manager["id"]
            )
            main = next(
                window for window in state["windows"] if window["id"] == main["id"]
            )
            client = manager["clientGeometry"]
            bounds, frame = item["bounds"], item["frameBounds"]
            if (
                abs(client["width"] - frame[2]) > 5
                or abs(client["height"] - frame[3]) > 5
            ):
                raise StepFailed(
                    f"Native file item coordinate frame does not match the compositor: {item}, {client}"
                )
            source_x = client["x"] + bounds[0] - frame[0] + bounds[2] / 2
            source_y = client["y"] + bounds[1] - frame[1] + bounds[3] / 2
            zone = driver.execute(
                "const r=document.querySelector('.ai-chat').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};"
            )
            destination_x = main["clientGeometry"]["x"] + zone["x"]
            destination_y = main["clientGeometry"]["y"] + zone["y"]
            screenshot = vm.run_dir / "before-native-drop.png"
            vm.qmp.screenshot(screenshot)
            width, height = struct.unpack(">II", screenshot.read_bytes()[16:24])
            if not all(
                0 <= x < width and 0 <= y < height
                for x, y in ((source_x, source_y), (destination_x, destination_y))
            ):
                raise StepFailed(
                    "Native drag endpoints are outside the virtual display"
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

            move(source_x, source_y)
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
                    time.sleep(0.025)
            finally:
                vm.qmp.execute(
                    "input-send-event",
                    events=[{"type": "btn", "data": {"down": False, "button": "left"}}],
                )

            def actual_file():
                result = driver.call(
                    "POST",
                    "/execute/async",
                    {
                        "script": "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('read_dropped_file',{path:arguments[0]}).then(buffer=>done({ok:true,bytes:Array.from(new Uint8Array(buffer))}),error=>done({ok:false,error}));",
                        "args": [remote],
                    },
                )
                return result["ok"] and bytes(result["bytes"]) == contents

            wait_for(
                "real drop authorized exact native file bytes", actual_file, timeout=15
            )
            wait_for(
                "dropped attachment visible in actual chat",
                lambda: driver.execute(
                    "return document.querySelector('.context-list')?.textContent.includes(arguments[0])",
                    [name],
                ),
                timeout=15,
            )
            protected = driver.invoke_result("read_dropped_file", {"path": sibling})
            if protected["ok"]:
                raise StepFailed("Native drop granted access to an undropped sibling")
            report["nativeDrop"] = {
                "sourceItem": item,
                "sourceWindow": manager,
                "targetWindow": main,
                "path": remote,
                "byteCount": len(contents),
            }
            vm.qmp.screenshot(vm.run_dir / "after-native-drop.png")
            return "Actual Dolphin file item dragged by USB pointer into real chat; Unicode/spaced path, exact Rust-read bytes and visible attachment verified; undropped sibling remained denied"
        finally:
            if started:
                guest("env-run systemctl --user stop tyco-vm-file-manager.service")
            guest(f"env-run {prefix}/tyco-ctl open editor")

    check("VM-14.file-drop", scenario)
