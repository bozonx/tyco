#!/usr/bin/env python3
"""A stand-in for ydotool 1.x on Xvfb, which reads no input devices.

`ydotool-xtest.py --daemon SOCKET` binds the datagram socket Tyco looks for
as the ydotoold one. Invoked as `ydotool`, it answers `key --help` like 1.x
and replays `key CODE:STATE...` through xdotool, so the desktop smoke test
covers Tyco's whole insertion path.
"""
import os
import socket
import subprocess
import sys
import time

# Linux input event codes Tyco presses, as X keysyms
KEYSYMS = {
    29: "Control_L",
    97: "Control_R",
    42: "Shift_L",
    54: "Shift_R",
    56: "Alt_L",
    100: "Alt_R",
    125: "Super_L",
    126: "Super_R",
    46: "c",
    47: "v",
    110: "Insert",
}


def daemon(path):
    if os.path.exists(path):
        os.unlink(path)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    server.bind(path)
    while True:
        time.sleep(3600)


def key(events):
    args = []
    pressed = set()
    for event in events:
        code, state = (int(part) for part in event.split(":"))
        if state:
            pressed.add(code)
            args += ["keydown", KEYSYMS[code]]
        elif code in pressed:
            # Tyco first releases modifiers it never pressed
            args += ["keyup", KEYSYMS[code]]
    if args:
        subprocess.run(["xdotool", *args], check=True)


def main(argv):
    if argv[:1] == ["--daemon"]:
        daemon(argv[1])
    elif argv == ["key", "--help"]:
        print("Syntax: <keycode>:<pressed>")
    elif argv[:1] == ["key"]:
        key(argv[1:])
    else:
        sys.exit(f"unsupported: {argv}")


main(sys.argv[1:])
