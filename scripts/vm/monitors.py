"""Exercise actual KScreen outputs and independently observed KWin windows."""

import json
import shlex

from vmlib import StepFailed, wait_for


def require(condition, message):
    if not condition:
        raise StepFailed(message)


def contains(outer, inner):
    return (
        inner["width"] > 0
        and inner["height"] > 0
        and inner["x"] >= outer["x"]
        and inner["y"] >= outer["y"]
        and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + 1
        and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + 1
    )


def run_monitor_check(*, vm, driver, guest, report, start, window_for, windows, insert):
    prefix = f"/home/{vm.user}/tyco-vm"

    def outputs():
        return json.loads(guest("env-run kscreen-doctor -j"))["outputs"]

    connected = [output for output in outputs() if output["connected"]]
    require(len(connected) == 2, f"Expected two real connected outputs: {connected}")
    ids = [str(output["id"]) for output in connected]
    for identifier in ids:
        guest(
            f"env-run kscreen-doctor output.{identifier}.enable output.{identifier}.mode.1920x1080@60"
        )
    observations = report.setdefault("monitorObservations", [])
    document = prefix + "/monitor document.txt"
    vm.ssh("printf %s '' > " + shlex.quote(document))
    start("monitor-kate", ["kate", "--new", "--block", document])
    target = window_for(
        lambda window: (
            "kate" in window["resourceClass"].lower()
            and "monitor document.txt" in window["title"]
        )
    )

    def move(identifier, x, y):
        path = vm.run_dir / "monitor-move.js"
        path.write_text(
            f"const w=workspace.windowList().find(w=>w.internalId.toString()==={json.dumps(identifier)});"
            f"if(w) {{w.frameGeometry={{x:{x},y:{y},width:640,height:400}}; workspace.activeWindow=w;}}"
        )
        vm.copy_to(path, "tyco-vm/monitor-move.js")
        guest(
            "env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s tyco-vm-monitor-move"
        )
        loaded = guest(
            f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss {prefix}/monitor-move.js tyco-vm-monitor-move"
        )
        guest(
            f"env-run busctl --user call org.kde.KWin /Scripting/Script{int(loaded.split()[-1])} org.kde.kwin.Script run"
        )

    def geometry(output):
        mode = next(
            mode for mode in output["modes"] if mode["id"] == output["currentModeId"]
        )
        return {
            **output["pos"],
            "width": mode["size"]["width"] / output["scale"],
            "height": mode["size"]["height"] / output["scale"],
        }

    expected = ""
    for cycle, (scale, primary, second_x) in enumerate(
        (
            (1, ids[0], 1920),
            (1.5, ids[1], 1920),
            (2, ids[0], 1920),
            (1.5, ids[1], -1280),
        )
    ):
        guest(
            f"env-run kscreen-doctor output.{ids[0]}.scale.1 output.{ids[0]}.position.0,0 output.{ids[1]}.scale.{scale} output.{ids[1]}.position.{second_x},0 output.{primary}.priority.1"
        )
        actual = outputs()
        screens = [
            geometry(
                next(output for output in actual if str(output["id"]) == identifier)
            )
            for identifier in ids
        ]
        observations.append({"cycle": cycle + 1, "outputs": actual, "windows": []})
        for screen in screens:
            move(target["id"], int(screen["x"] + 20), int(screen["y"] + 40))
            wait_for(
                "target moved to the requested screen",
                lambda: any(
                    window["id"] == target["id"]
                    and contains(screen, window["geometry"])
                    for window in windows()["windows"]
                ),
            )
            text = f"Monitor cycle {cycle + 1} screen {int(screen['x'])};|"

            def quick_visible():
                observed = windows()
                quick = next(
                    (
                        window
                        for window in observed["windows"]
                        if window["id"] == observed["activeWindowId"]
                    ),
                    None,
                )
                require(
                    quick is not None
                    and quick["resourceClass"] == "tyco"
                    and contains(screen, quick["geometry"]),
                    f"Quick window is outside target screen: {quick}; {screen}",
                )
                observations[-1]["windows"].append({"screen": screen, "quick": quick})

            insert(target, text, observe_quick=quick_visible)
            expected += text
            vm.qmp.tap("ctrl", "s")
            wait_for(
                "exact Kate bytes after monitor insertion",
                lambda: (
                    vm.ssh("cat " + shlex.quote(document))
                    in (expected, expected + "\n")
                ),
            )
        vm.qmp.screenshot(vm.run_dir / f"monitors-{cycle}.png")

    # Keep the recipient and main window on the output that is removed.
    second = screens[1]
    move(target["id"], int(second["x"] + 20), 40)
    guest(f"env-run {prefix}/tyco-ctl open editor")
    driver.window("main", ".cm-editor")
    main = window_for(
        lambda window: window["resourceClass"] == "tyco" and window["normalWindow"]
    )
    move(main["id"], int(second["x"] + 20), 40)

    def remove_output():
        guest(
            f"env-run kscreen-doctor output.{ids[0]}.priority.1 output.{ids[1]}.disable"
        )
        remaining = geometry(
            next(output for output in outputs() if str(output["id"]) == ids[0])
        )
        for identifier in (target["id"], main["id"]):
            wait_for(
                "window recovered to remaining display",
                lambda identifier=identifier: any(
                    window["id"] == identifier
                    and contains(remaining, window["geometry"])
                    for window in windows()["windows"]
                ),
            )
        wait_for(
            "visible quick panel recovered after output removal",
            lambda: any(
                window["resourceClass"] == "tyco"
                and window["id"] == windows()["activeWindowId"]
                and contains(remaining, window["geometry"])
                for window in windows()["windows"]
            ),
        )

    insert(target, "After output removal", observe_quick=remove_output)
    expected += "After output removal"
    vm.qmp.tap("ctrl", "s")
    wait_for(
        "exact bytes after output removal",
        lambda: vm.ssh("cat " + shlex.quote(document)) in (expected, expected + "\n"),
    )
    observations.append({"afterRemoval": outputs(), "windows": windows()})
    return "Two actual outputs, mixed 100/150/200 percent DPI, primary/negative-origin changes, quick placement and exact Kate delivery on both; disabled output relocates main/target/visible quick and preserves native insertion"
