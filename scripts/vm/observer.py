"""Independent KWin observation sink, with no Tyco imports or IPC calls."""

import json
from pathlib import Path
import time

from gi.repository import Gio, GLib

root = Path.home() / "tyco-vm"
info = Gio.DBusNodeInfo.new_for_xml(
    """<node><interface name="org.tyco.VmObserver"><method name="Observe"><arg type="s" direction="in"/></method></interface></node>"""
)


def observe(_connection, _sender, _path, _interface, _method, parameters, invocation):
    value = json.loads(parameters.unpack()[0])
    value["observedAt"] = time.monotonic()
    temporary = root / "windows.tmp"
    temporary.write_text(json.dumps(value))
    temporary.replace(root / "windows.json")
    with (root / "windows.jsonl").open("a") as stream:
        stream.write(json.dumps(value) + "\n")
    invocation.return_value(GLib.Variant("()", ()))


def acquired(connection, _name):
    connection.register_object(
        "/org/tyco/VmObserver", info.interfaces[0], observe, None, None
    )


owner = Gio.bus_own_name(
    Gio.BusType.SESSION,
    "org.tyco.VmObserver",
    Gio.BusNameOwnerFlags.NONE,
    acquired,
    None,
    None,
)
GLib.MainLoop().run()
