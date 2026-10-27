"""Foreign GTK client for platform tests; no Tyco code runs in this process."""
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=DeprecationWarning)

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk  # noqa: E402

root = Path(sys.argv[1])
name = sys.argv[2]
GLib.set_prgname(name)
window = Gtk.Window(title=name)
window.set_wmclass(name, name)
window.set_default_size(480, 240)
entry = Gtk.Entry()
window.add(entry)


def record(*_args):
    print(f"{name}: text={entry.get_text()!r}", file=sys.stderr, flush=True)
    temporary = root / (name + ".tmp")
    temporary.write_text(entry.get_text(), encoding="utf-8")
    temporary.replace(root / (name + ".text"))


def poll():
    (root / (name + ".focused")).write_text(str(entry.has_focus()), encoding="utf-8")
    command = root / (name + ".command")
    if command.exists():
        action = command.read_text(encoding="utf-8")
        command.unlink()
        if action == "select":
            entry.set_text("Selected source text")
            entry.select_region(0, -1)
        elif action == "clear":
            entry.set_text("")
        (root / (name + ".ack")).write_text(action, encoding="utf-8")
    return True


def key_event(_widget, event):
    print(f"{name}: key={event.keyval} state={int(event.state)}", file=sys.stderr, flush=True)
    return False


entry.connect("key-press-event", key_event)
entry.connect("changed", record)
window.connect("destroy", Gtk.main_quit)
window.show_all()
entry.grab_focus()
record()
GLib.timeout_add(25, poll)
Gtk.main()
