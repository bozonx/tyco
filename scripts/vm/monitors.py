"""Exercise actual KScreen outputs and independently observed KWin windows."""

import json
import shlex
import uuid

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


def output_settings_match(outputs, desired):
    observed = {str(output["id"]): output for output in outputs}
    return all(
        identifier in observed
        and all(
            observed[identifier].get(key) == value for key, value in settings.items()
        )
        for identifier, settings in desired.items()
    )


def run_monitor_check(*, vm, driver, guest, report, start, window_for, windows, insert):
    prefix = f"/home/{vm.user}/tyco-vm"

    def outputs():
        return json.loads(guest("env-run kscreen-doctor -j"))["outputs"]

    connected = [output for output in outputs() if output["connected"]]
    require(len(connected) == 2, f"Expected two real connected outputs: {connected}")
    ids = [str(output["id"]) for output in connected]

    def configure(options, desired):
        evidence = {
            "options": options,
            "desired": desired,
            "response": guest("env-run kscreen-doctor " + options),
        }
        report.setdefault("monitorConfigurations", []).append(evidence)

        def applied():
            actual = outputs()
            evidence["observed"] = actual
            return actual if output_settings_match(actual, desired) else None

        return wait_for(
            "actual KScreen configuration, not just CLI success", applied, timeout=20
        )

    for identifier in ids:
        output = next(output for output in connected if str(output["id"]) == identifier)
        mode = next(mode for mode in output["modes"] if mode["name"] == "1920x1080@60")
        configure(
            f"output.{identifier}.enable output.{identifier}.mode.1920x1080@60",
            {identifier: {"enabled": True, "currentModeId": mode["id"]}},
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
        name = "tyco-vm-monitor-move-" + uuid.uuid4().hex
        path = vm.run_dir / (name + ".js")
        path.write_text(
            f"const w=workspace.windowList().find(w=>w.internalId.toString()==={json.dumps(identifier)});"
            f"if(w) {{const output=workspace.screenAt({{x:{x + 320},y:{y + 200}}});"
            "if(output) workspace.sendClientToScreen(w,output);"
            f"w.frameGeometry={{x:{x},y:{y},width:640,height:400}}; workspace.activeWindow=w;}}"
        )
        vm.copy_to(path, "tyco-vm/" + path.name)
        loaded = guest(
            f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss {prefix}/{path.name} {name}"
        )
        try:
            guest(
                f"env-run busctl --user call org.kde.KWin /Scripting/Script{int(loaded.split()[-1])} org.kde.kwin.Script run"
            )
            wait_for(
                "native window moved to requested coordinates",
                lambda: any(
                    window["id"] == identifier
                    and abs(window["geometry"]["x"] - x) <= 1
                    and abs(window["geometry"]["y"] - y) <= 1
                    for window in windows()["windows"]
                ),
            )
        finally:
            guest(
                f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s {name}"
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
    for cycle, (scale, primary, first_x, second_x) in enumerate(
        (
            (1, ids[0], 0, 1920),
            (1.5, ids[1], 0, 1920),
            (2, ids[0], 0, 1920),
            (1.5, ids[1], 1280, 0),
        )
    ):
        first_priority = 1 if primary == ids[0] else 2
        second_priority = 1 if primary == ids[1] else 2
        actual = configure(
            f"output.{ids[0]}.scale.1 output.{ids[0]}.position.{first_x},0 output.{ids[0]}.priority.{first_priority} output.{ids[1]}.scale.{scale} output.{ids[1]}.position.{second_x},0 output.{ids[1]}.priority.{second_priority}",
            {
                ids[0]: {
                    "enabled": True,
                    "scale": 1,
                    "pos": {"x": first_x, "y": 0},
                    "priority": first_priority,
                },
                ids[1]: {
                    "enabled": True,
                    "scale": scale,
                    "pos": {"x": second_x, "y": 0},
                    "priority": second_priority,
                },
            },
        )

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
                def located():
                    observed = windows()
                    quick = next(
                        (
                            window
                            for window in observed["windows"]
                            if window["id"] == observed["activeWindowId"]
                        ),
                        None,
                    )
                    observations[-1]["lastQuickGeometry"] = quick
                    return (
                        quick
                        if quick is not None
                        and quick["resourceClass"] == "tyco"
                        and contains(screen, quick["geometry"])
                        else None
                    )

                quick = wait_for(
                    "configured quick geometry on target display", located, timeout=15
                )
                viewport = driver.execute(
                    "const r=document.querySelector('textarea').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,pixelRatio:devicePixelRatio};"
                )
                require(
                    viewport["width"] > 0
                    and viewport["height"] > 0
                    and viewport["x"] >= 0
                    and viewport["y"] >= 0
                    and viewport["x"] + viewport["width"]
                    <= viewport["viewportWidth"] + 1
                    and viewport["y"] + viewport["height"]
                    <= viewport["viewportHeight"] + 1,
                    f"Quick input is clipped at this DPI: {viewport}",
                )
                observations[-1]["windows"].append(
                    {"screen": screen, "quick": quick, "viewport": viewport}
                )

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

    def disable_output():
        actual = configure(
            f"output.{ids[0]}.position.0,0 output.{ids[0]}.priority.1 output.{ids[1]}.disable",
            {
                ids[0]: {"enabled": True, "priority": 1, "pos": {"x": 0, "y": 0}},
                ids[1]: {"enabled": False},
            },
        )
        return geometry(
            next(output for output in actual if str(output["id"]) == ids[0])
        )

    remaining = disable_output()
    for identifier in (target["id"], main["id"]):
        wait_for(
            "visible main/recipient moved off disabled output",
            lambda identifier=identifier: any(
                window["id"] == identifier and contains(remaining, window["geometry"])
                for window in windows()["windows"]
            ),
        )
    wait_for(
        "main keeps native focus after output removal",
        lambda: windows()["activeWindowId"] == main["id"],
    )
    visible = windows()
    require(
        [
            window["id"]
            for window in visible["windows"]
            if window["resourceClass"] == "tyco"
        ]
        == [main["id"]],
        "Output removal resurrected a hidden Quick panel",
    )
    observations.append({"mainAfterRemoval": visible, "outputs": outputs()})
    actual = configure(
        f"output.{ids[0]}.position.0,0 output.{ids[0]}.scale.1 output.{ids[1]}.enable output.{ids[1]}.scale.1.5 output.{ids[1]}.position.1920,0",
        {
            ids[0]: {"enabled": True, "pos": {"x": 0, "y": 0}, "scale": 1},
            ids[1]: {"enabled": True, "pos": {"x": 1920, "y": 0}, "scale": 1.5},
        },
    )
    second = geometry(next(output for output in actual if str(output["id"]) == ids[1]))
    move(target["id"], int(second["x"] + 20), 40)

    def remove_output():
        def owns_focus():
            observed = windows()
            return any(
                window["resourceClass"] == "tyco"
                and window["id"] == observed["activeWindowId"]
                for window in observed["windows"]
            )

        wait_for("Quick owns native focus before draft input", owns_focus)
        for key in "draft":
            vm.qmp.tap(key)
        wait_for(
            "physical draft typed into Quick",
            lambda: (
                driver.execute("return document.querySelector('textarea').value")
                == "draft"
            ),
        )
        remaining = disable_output()
        wait_for(
            "recipient recovered to remaining display",
            lambda: any(
                window["id"] == target["id"] and contains(remaining, window["geometry"])
                for window in windows()["windows"]
            ),
        )

        def visible_quick():
            observed = windows()
            return any(
                window["resourceClass"] == "tyco"
                and window["id"] == observed["activeWindowId"]
                and contains(remaining, window["geometry"])
                for window in observed["windows"]
            )

        wait_for("visible quick panel recovered after output removal", visible_quick)
        driver.window("quick", "textarea")
        require(
            driver.execute("return document.querySelector('textarea').value")
            == "draft",
            "Output removal lost the user's draft",
        )
        report["monitorDraftPreserved"] = True

    insert(target, "draft", observe_quick=remove_output)
    expected += "draft"
    vm.qmp.tap("ctrl", "s")
    wait_for(
        "exact bytes after output removal",
        lambda: vm.ssh("cat " + shlex.quote(document)) in (expected, expected + "\n"),
    )
    observations.append({"afterRemoval": outputs(), "windows": windows()})
    return "Two actual outputs, mixed 100/150/200 percent DPI, primary and left/right layouts, quick placement and exact Kate delivery on both; disabled output relocates visible main/recipient/quick and preserves native insertion"
