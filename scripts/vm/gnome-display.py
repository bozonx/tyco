"""Read/apply real Mutter monitor configuration; no Shell extension or Eval."""

import json
import sys

from gi.repository import Gio, GLib

connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def call(method, arguments=None):
    return connection.call_sync(
        "org.gnome.Mutter.DisplayConfig",
        "/org/gnome/Mutter/DisplayConfig",
        "org.gnome.Mutter.DisplayConfig",
        method,
        arguments,
        None,
        Gio.DBusCallFlags.NONE,
        10000,
        None,
    ).unpack()


state = call("GetCurrentState")
if len(sys.argv) > 1:
    desired = json.loads(sys.argv[1])
    logical = []
    for item in desired:
        logical.append(
            (
                item["x"],
                item["y"],
                item["scale"],
                0,
                item["primary"],
                [(item["connector"], item["mode"], {})],
            )
        )
    call(
        "ApplyMonitorsConfig",
        GLib.Variant(
            "(uua(iiduba(ssa{sv}))a{sv})",
            (state[0], 1, logical, {"layout-mode": GLib.Variant("u", 1)}),
        ),
    )
    state = call("GetCurrentState")
print(
    json.dumps(
        {
            "serial": state[0],
            "monitors": state[1],
            "logical": state[2],
            "properties": state[3],
        }
    )
)
