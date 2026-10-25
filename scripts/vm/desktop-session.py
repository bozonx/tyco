"""Hold a real KWin show-desktop request until this fixture is stopped."""

import signal

from gi.repository import Gio, GLib

connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
loop = GLib.MainLoop()


def show_desktop(enabled):
    connection.call_sync(
        "org.kde.KWin",
        "/KWin",
        "org.kde.KWin",
        "showDesktop",
        GLib.Variant("(b)", (enabled,)),
        None,
        Gio.DBusCallFlags.NONE,
        5000,
        None,
    )


def stop():
    show_desktop(False)
    loop.quit()
    return GLib.SOURCE_REMOVE


# KWin clears show-desktop when its D-Bus caller disconnects, so the
# connection must remain alive while the native desktop check is running.
show_desktop(True)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, stop)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, stop)
loop.run()
connection.flush_sync(None)
