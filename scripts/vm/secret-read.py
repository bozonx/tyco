"""Read native Secret Service bytes without CLI text/binary formatting."""

import hashlib
import json
import sys

from gi.repository import Gio, GLib

connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def call(path, interface, method, arguments=None):
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


service = "org.freedesktop.Secret.Service"
root = "/org/freedesktop/secrets"
_, session = call(
    root, service, "OpenSession", GLib.Variant("(sv)", ("plain", GLib.Variant("s", "")))
)
try:
    unlocked, locked = call(
        root,
        service,
        "SearchItems",
        GLib.Variant(
            "(a{ss})", ({"service": "com.tyco.app", "username": sys.argv[1]},)
        ),
    )
    result = {"lockedItems": locked, "items": []}
    for path in dict.fromkeys(unlocked):
        secret = call(
            path,
            "org.freedesktop.Secret.Item",
            "GetSecret",
            GLib.Variant("(o)", (session,)),
        )[0]
        value = bytes(secret[2])
        result["items"].append(
            {
                "path": path,
                "byteCount": len(value),
                "sha256": hashlib.sha256(value).hexdigest(),
                "contentType": secret[3],
            }
        )
finally:
    call(session, "org.freedesktop.Secret.Session", "Close")
print(json.dumps(result))
