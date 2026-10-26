"""Read native portal accessibility nodes; host injects physical QMP clicks."""

import json
import sys

import gi

from accessibility import application_nodes

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

Atspi.set_timeout(2000, 3000)
result = []
visited = set()


def visit(node, application, depth=0):
    if node in visited:
        return
    visited.add(node)
    if depth > 16 or len(result) >= 2000:
        return
    try:
        name = node.get_name() or ""
        role = node.get_role_name()
        states = node.get_state_set()
        showing = states.contains(Atspi.StateType.SHOWING)
        entry = {
            "application": application,
            "name": name,
            "role": role,
            "showing": showing,
            "focused": states.contains(Atspi.StateType.FOCUSED),
            "sensitive": states.contains(Atspi.StateType.SENSITIVE),
            "checked": states.contains(Atspi.StateType.CHECKED),
        }
        if role in ("push button", "button", "toggle button", "label") and showing:
            box = node.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
            entry["bounds"] = [box.x, box.y, box.width, box.height]
        if name or role in (
            "dialog",
            "frame",
            "text",
            "entry",
            "password text",
            "terminal",
        ):
            result.append(entry)
        for index in range(node.get_child_count()):
            child = node.get_child_at_index(index)
            if child:
                visit(child, application, depth + 1)
    except Exception:
        return


desktop = Atspi.get_desktop(0)
for application, name in application_nodes(desktop):
    if len(sys.argv) == 3 and sys.argv[1] == "--application":
        if name == sys.argv[2]:
            visit(application, name)
    elif "portal" in name.lower() or len(sys.argv) > 1:
        visit(application, name)
print(json.dumps(result))
