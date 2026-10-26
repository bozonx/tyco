"""Physical pointer input targeted by independently observed native controls."""

import re
import json
import struct

from vmlib import StepFailed, wait_for


def click_native(
    vm, guest, application, name, roles=("button", "push button"), pattern=False
):
    def control():
        nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
        matches = [
            node
            for node in nodes
            if node["application"] == application
            and (
                bool(re.search(name, node["name"])) if pattern else node["name"] == name
            )
            and node.get("showing")
            and (node.get("sensitive") or node["role"] == "label")
            and node.get("bounds")
            and node["role"] in roles
        ]
        return matches[0] if len(matches) == 1 else None

    node = wait_for("unique native control " + name, control, timeout=15)
    screenshot = vm.run_dir / "native-pointer-target.png"
    vm.qmp.screenshot(screenshot)
    width, height = struct.unpack(">II", screenshot.read_bytes()[16:24])
    x, y, w, h = node["bounds"]
    x, y = x + w / 2, y + h / 2
    if not (w > 0 and h > 0 and 0 <= x < width and 0 <= y < height):
        raise StepFailed(f"Native control outside the observed screen: {node}")
    vm.qmp.execute(
        "input-send-event",
        events=[
            {
                "type": "abs",
                "data": {"axis": "x", "value": round(x * 32767 / (width - 1))},
            },
            {
                "type": "abs",
                "data": {"axis": "y", "value": round(y * 32767 / (height - 1))},
            },
        ],
    )
    for down in (True, False):
        vm.qmp.execute(
            "input-send-event",
            events=[{"type": "btn", "data": {"down": down, "button": "left"}}],
        )
    return node
