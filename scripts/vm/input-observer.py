"""Observe guest kernel USB keyboard events without grabbing the device."""

import json
import os
from pathlib import Path
import select
import struct
import time

root = Path("/home/tester/tyco-vm")
paths = list(Path("/dev/input/by-id").glob("*kbd"))
if not paths:
    raise RuntimeError("No independently observable USB keyboard")
streams = [os.open(path, os.O_RDONLY | os.O_NONBLOCK) for path in paths]
packet = struct.Struct("@llHHI")
pressed = set()
events = []
while True:
    for fd in select.select(streams, [], [], 0.1)[0]:
        data = os.read(fd, packet.size * 64)
        for offset in range(0, len(data), packet.size):
            seconds, micros, kind, code, value = packet.unpack_from(data, offset)
            if kind != 1:
                continue
            if value:
                pressed.add(code)
            else:
                pressed.discard(code)
            events.append({"code": code, "value": value, "at": seconds + micros / 1e6})
    temporary = root / "input-state.tmp"
    temporary.write_text(
        json.dumps(
            {
                "pressed": sorted(pressed),
                "events": events[-100:],
                "observedAt": time.monotonic(),
                "devices": [str(path) for path in paths],
            }
        )
    )
    temporary.chmod(0o644)
    temporary.replace(root / "input-state.json")
