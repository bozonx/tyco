"""Independent multiline GTK receiver: records actual text, focus and keys."""

import base64
from importlib import import_module
import json
import os
from pathlib import Path
import sys
import time

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk  # noqa: E402

root = Path(sys.argv[1])
backend = sys.argv[2]
name = f"TycoVmReceiver-{backend}"
GLib.set_prgname(name)
window = Gtk.Window(title=name)
window.set_default_size(620, 340)
view = Gtk.TextView()
view.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
window.add(view)
buffer = view.get_buffer()
changes = 0
keys = []
focus_events = []


def changed(*_args):
    global changes
    changes += 1


def key_press(_widget, event):
    keys.append(
        {"keyval": event.keyval, "state": int(event.state), "time": time.monotonic()}
    )
    return False


def focus(_widget, event):
    focus_events.append({"focused": bool(event.in_), "time": time.monotonic()})
    return False


def poll():
    command = root / f"receiver-{backend}.command.json"
    if command.exists():
        data = json.loads(command.read_text())
        command.unlink()
        if data["action"] == "reset":
            buffer.set_text(data.get("text", ""))
            if data.get("select"):
                buffer.select_range(
                    buffer.get_iter_at_offset(data.get("selectStart", 0)),
                    buffer.get_iter_at_offset(
                        data.get("selectEnd", buffer.get_char_count())
                    ),
                )
        elif data["action"] == "clipboard":
            import_module("clipboard-owner").offer(
                data["mime"], base64.b64decode(data["data"])
            )
        elif data["action"] == "read-clipboard":
            from gi.repository import Gdk

            clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
            identifier = data["id"]

            def received(_clipboard, selection, _user):
                payload = selection.get_data()
                (root / "clipboard-read.json").write_text(
                    json.dumps(
                        {
                            "id": identifier,
                            "data": base64.b64encode(payload or b"").decode(),
                        }
                    )
                )

            clipboard.request_contents(
                Gdk.Atom.intern(data["mime"], False), received, None
            )
        elif data["action"] == "title":
            window.set_title(data["title"])
        elif data["action"] == "present":
            window.present()
            view.grab_focus()
        elif data["action"] == "close":
            Gtk.main_quit()
        (root / f"receiver-{backend}.ack").write_text(data["id"])
    start, end = buffer.get_bounds()
    data = {
        "pid": os.getpid(),
        "backend": backend,
        "title": window.get_title(),
        "text": buffer.get_text(start, end, True),
        "focused": bool(window.is_active() and view.has_focus()),
        "changeCount": changes,
        "keys": keys[-200:],
        "focusEvents": focus_events[-200:],
    }
    path = root / f"receiver-{backend}.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False))
    temporary.replace(path)
    return True


buffer.connect("changed", changed)
view.connect("key-press-event", key_press)
window.connect("focus-in-event", focus)
window.connect("focus-out-event", focus)
window.connect("destroy", Gtk.main_quit)
window.show_all()
view.grab_focus()
GLib.timeout_add(50, poll)
Gtk.main()
