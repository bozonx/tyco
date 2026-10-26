"""Independent native WebKitGTK browser; page observations use loopback HTTP."""

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2

window = Gtk.Window(title="Tyco VM Web Browser Receiver")
window.set_default_size(800, 500)
view = WebKit2.WebView()
window.add(view)
window.connect("destroy", Gtk.main_quit)
view.load_uri("http://127.0.0.1:8731/")
window.show_all()
view.grab_focus()
Gtk.main()
