"""Read/change GNOME's real per-application GlobalShortcuts settings."""

import json
import sys

from gi.repository import Gio, GLib

settings = Gio.Settings.new_with_path(
    "org.gnome.settings-daemon.global-shortcuts.application",
    "/org/gnome/settings-daemon/global-shortcuts/com.tyco.app/",
)
value = settings.get_value("shortcuts")
if len(sys.argv) > 1:
    identifier, shortcut = sys.argv[1:3]
    entries = []
    found = False
    for index in range(value.n_children()):
        entry = value.get_child_value(index)
        name = entry.get_child_value(0).get_string()
        fields = entry.get_child_value(1)
        properties = {}
        for field in range(fields.n_children()):
            pair = fields.get_child_value(field)
            properties[pair.get_child_value(0).get_string()] = pair.get_child_value(
                1
            ).get_variant()
        if name == identifier:
            found = True
            properties["shortcuts"] = GLib.Variant("as", [shortcut] if shortcut else [])
        entries.append((name, properties))
    if not found:
        raise RuntimeError("Native shortcut is missing")
    if not settings.set_value("shortcuts", GLib.Variant("a(sa{sv})", entries)):
        raise RuntimeError("GNOME rejected shortcut configuration")
    Gio.Settings.sync()
    # GNOME's settings UI persists the definitions and then asks the portal
    # backend to rebind them; changing dconf alone does not change live grabs.
    connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    connection.call_sync(
        "org.freedesktop.impl.portal.desktop.gnome",
        "/org/gnome/globalshortcuts",
        "org.gnome.GlobalShortcutsRebind",
        "RebindShortcuts",
        GLib.Variant("(sa(sa{sv}))", ("com.tyco.app", entries)),
        None,
        Gio.DBusCallFlags.NONE,
        10000,
        None,
    )
print(json.dumps(settings.get_value("shortcuts").unpack()))
