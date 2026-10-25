"""Offer one exact MIME type through the receiver's real GTK clipboard."""

import ctypes

from gi.repository import Gdk, Gtk

OWNER = None


class TargetEntry(ctypes.Structure):
    _fields_ = [
        ("target", ctypes.c_char_p),
        ("flags", ctypes.c_uint),
        ("info", ctypes.c_uint),
    ]


def offer(mime, payload):
    global OWNER
    gtk = ctypes.CDLL("libgtk-3.so.0")
    gdk = ctypes.CDLL("libgdk-3.so.0")
    pointer = ctypes.pythonapi.PyCapsule_GetPointer
    pointer.argtypes = [ctypes.py_object, ctypes.c_char_p]
    pointer.restype = ctypes.c_void_p
    clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
    clipboard_pointer = pointer(clipboard.__gpointer__, None)
    targets = (TargetEntry * 1)(TargetEntry(mime.encode(), 0, 0))
    buffer = (ctypes.c_ubyte * len(payload)).from_buffer_copy(payload)
    get_type = ctypes.CFUNCTYPE(
        None, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p
    )
    clear_type = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_void_p)
    gdk.gdk_atom_intern.argtypes = [ctypes.c_char_p, ctypes.c_int]
    gdk.gdk_atom_intern.restype = ctypes.c_void_p
    atom = gdk.gdk_atom_intern(mime.encode(), 0)
    gtk.gtk_selection_data_set.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_int,
    ]
    gtk.gtk_clipboard_set_with_data.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(TargetEntry),
        ctypes.c_uint,
        get_type,
        clear_type,
        ctypes.c_void_p,
    ]
    gtk.gtk_clipboard_set_with_data.restype = ctypes.c_int

    @get_type
    def get_data(_clipboard, selection, _info, _user):
        gtk.gtk_selection_data_set(selection, atom, 8, buffer, len(payload))

    @clear_type
    def clear_data(_clipboard, _user):
        pass

    if not gtk.gtk_clipboard_set_with_data(
        clipboard_pointer, targets, 1, get_data, clear_data, None
    ):
        raise RuntimeError("GTK rejected the exact-MIME clipboard owner")
    # Keep callback and payload storage alive until another owner replaces it.
    OWNER = (clipboard, targets, buffer, get_data, clear_data)
