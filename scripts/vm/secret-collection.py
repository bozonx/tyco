"""Create a native test collection while retaining ownership of its prompt."""

import json
from pathlib import Path
import sys

from gi.repository import Gio, GLib

state_path = Path.home() / "tyco-vm/keyring-collection.json"
connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
loop = GLib.MainLoop()
state = {}


def publish(**values):
    state.update(values)
    state_path.write_text(json.dumps(state))


def call(path, interface, method, arguments):
    return connection.call_sync(
        "org.freedesktop.secrets",
        path,
        interface,
        method,
        arguments,
        None,
        Gio.DBusCallFlags.NONE,
        10000,
        None,
    ).unpack()


collection, prompt = call(
    "/org/freedesktop/secrets",
    "org.freedesktop.Secret.Service",
    "CreateCollection",
    GLib.Variant(
        "(a{sv}s)",
        (
            {
                "org.freedesktop.Secret.Collection.Label": GLib.Variant(
                    "s", "Tyco VM Test Collection"
                )
            },
            "default",
        ),
    ),
)
if prompt == "/":
    publish(completed=True, dismissed=False, collection=collection)
    sys.exit(0)


def completed(_connection, _sender, _path, _interface, _signal, parameters):
    dismissed, result = parameters.unpack()
    publish(completed=True, dismissed=dismissed, collection=result)
    loop.quit()


def timed_out():
    publish(error="Native collection prompt timed out")
    loop.quit()
    return False


connection.signal_subscribe(
    "org.freedesktop.secrets",
    "org.freedesktop.Secret.Prompt",
    "Completed",
    prompt,
    None,
    Gio.DBusSignalFlags.NONE,
    completed,
)
call(prompt, "org.freedesktop.Secret.Prompt", "Prompt", GLib.Variant("(s)", ("",)))
publish(prompt=prompt, completed=False)
GLib.timeout_add_seconds(90, timed_out)
loop.run()
sys.exit(0 if state.get("completed") and not state.get("dismissed") else 1)
