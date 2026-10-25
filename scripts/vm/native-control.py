"""Operate real native accessibility controls in a disposable test session."""

import json
import sys

import gi

from accessibility import application_nodes

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

Atspi.set_timeout(2000, 3000)
action, application_name = sys.argv[1:3]
argument = sys.argv[3] if len(sys.argv) > 3 else ""
found = []
visited = set()


def visit(node, depth=0):
    if node in visited:
        return
    visited.add(node)
    if depth > 20 or len(found) >= 3000:
        return
    states = node.get_state_set()
    if states.contains(Atspi.StateType.SHOWING) or states.contains(
        Atspi.StateType.FOCUSED
    ):
        found.append(node)
    for index in range(node.get_child_count()):
        child = node.get_child_at_index(index)
        if child:
            visit(child, depth + 1)


desktop = Atspi.get_desktop(0)
for application, name in application_nodes(desktop):
    if name.lower() == application_name.lower():
        visit(application)

if action == "locate-name":
    matches = [
        node
        for node in found
        if (node.get_name() or "") == argument
        and node.get_role_name()
        in ("icon", "list item", "table cell", "tree item", "label")
    ]
    preferred = [node for node in matches if node.get_role_name() != "label"]
    if preferred:
        matches = preferred
    locations = []
    for node in matches:
        parent = node
        while parent and parent.get_role_name() not in (
            "frame",
            "dialog",
            "file chooser",
        ):
            parent = parent.get_parent()
        if parent:
            box = node.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
            frame = parent.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
            locations.append(
                {
                    "role": node.get_role_name(),
                    "bounds": [box.x, box.y, box.width, box.height],
                    "frameBounds": [frame.x, frame.y, frame.width, frame.height],
                }
            )
    print(json.dumps(locations))
elif action == "show-folder-location":
    matches = []
    for node in found:
        if node.get_role_name() != "file chooser":
            continue
        interface = node.get_action_iface()
        if not interface:
            continue
        for index in range(interface.get_n_actions()):
            if interface.get_action_name(index) == "show_location":
                matches.append((node, index))
    if len(matches) != 1:
        raise RuntimeError(f"Expected one native file location action: {len(matches)}")
    node, index = matches[0]
    if not node.get_action_iface().do_action(index):
        raise RuntimeError("Native file location action failed")
    print(json.dumps({"action": "show_location", "role": node.get_role_name()}))
elif action == "expand-row":
    rows = {
        node
        for node in found
        if node.get_role_name() == "list item"
        and (node.get_name() or "").startswith(argument)
    }
    matches = []
    for node in found:
        if (
            node.get_role_name() not in ("button", "push button")
            or node.get_name() != "Expand to configure shortcuts"
        ):
            continue
        parent = node.get_parent()
        chain = set()
        while parent and parent not in chain:
            chain.add(parent)
            if parent in rows:
                matches.append(node)
                break
            parent = parent.get_parent()
    if len(matches) != 1 or not matches[0].get_action_iface().do_action(0):
        raise RuntimeError(
            f"Could not expand the unique native shortcut row: {len(matches)}"
        )
    print(json.dumps({"expanded": True}))
elif action == "has-text":
    matches = []
    for node in found:
        if node.get_role_name() == "password text":
            continue
        try:
            interface = node.get_text_iface()
            text = Atspi.Text.get_text(node, 0, -1) if interface else None
            if text == argument:
                matches.append(node)
        except Exception:
            pass
    print(json.dumps({"matched": bool(matches)}))
elif action == "click":
    matches = [
        node
        for node in found
        if (node.get_name() or "").replace("&", "") == argument
        and node.get_state_set().contains(Atspi.StateType.SENSITIVE)
        and node.get_role_name()
        in ("button", "push button", "radio button", "check box")
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected one enabled control {argument!r}, got {len(matches)}"
        )
    interface = matches[0].get_action_iface()
    if not interface or not interface.do_action(0):
        raise RuntimeError(f"Native action failed: {argument}")
    print(json.dumps({"clicked": argument}))
elif action == "focus-password":
    matches = [node for node in found if node.get_role_name() == "password text"]
    if len(matches) != 1 or not matches[0].get_component_iface().grab_focus():
        raise RuntimeError("Could not focus the unique native password field")
    print(json.dumps({"focused": True}))
elif action == "fill-passwords":
    matches = [node for node in found if node.get_role_name() == "password text"]
    if not matches:
        raise RuntimeError("No native password fields found")
    for node in matches:
        if not node.get_editable_text_iface().set_text_contents(argument):
            raise RuntimeError("Could not fill a native password field")
    print(json.dumps({"filledCount": len(matches)}))
else:
    raise RuntimeError(f"Unknown native action: {action}")
