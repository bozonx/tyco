"""Raw terminal receiver: records pasted bytes without invoking a shell."""

import base64
import json
import os
from pathlib import Path
import select
import sys
import termios
import tty

root = Path.home() / "tyco-vm"
fd = sys.stdin.fileno()
previous = termios.tcgetattr(fd)
raw = bytearray()


def record():
    payload = bytes(raw).replace(b"\x1b[200~", b"").replace(b"\x1b[201~", b"")
    path = root / "terminal.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(
            {
                "pid": os.getpid(),
                "text": payload.decode("utf-8", errors="replace"),
                "rawBase64": base64.b64encode(raw).decode(),
                "enterCount": payload.count(b"\r") + payload.count(b"\n"),
            }
        )
    )
    temporary.replace(path)


try:
    tty.setraw(fd)
    sys.stdout.write("\x1b[?2004hTyco VM terminal receiver ready\r\n")
    sys.stdout.flush()
    record()
    while True:
        if select.select([fd], [], [], 1)[0]:
            chunk = os.read(fd, 4096)
            if not chunk:
                break
            raw.extend(chunk)
            record()
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, previous)
