"""Keep one independently observed receiver per backend in a disposable guest."""

import json
import shlex

from vmlib import StepFailed, wait_for


def start_receiver(vm, guest, backend):
    fixture = f"/home/{vm.user}/tyco-vm/receiver.py"
    cleanup = """
import os, signal
from pathlib import Path
fixture, backend = FIXTURE, BACKEND
for path in Path('/proc').glob('[0-9]*/cmdline'):
    try:
        args = path.read_bytes().split(b'\\0')
        if fixture.encode() in args and backend.encode() in args:
            os.kill(int(path.parent.name), signal.SIGTERM)
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        pass
root = Path.home() / 'tyco-vm'
for suffix in ('.json', '.command.json', '.ack'):
    (root / ('receiver-' + backend + suffix)).unlink(missing_ok=True)
""".replace("FIXTURE", repr(fixture)).replace("BACKEND", repr(backend))
    vm.ssh("python3 -c " + shlex.quote(cleanup))
    pid = int(guest("receiver " + backend).strip())

    def ready():
        try:
            state = json.loads(vm.ssh(f"cat tyco-vm/receiver-{backend}.json"))
            return state if state.get("pid") == pid else None
        except (StepFailed, json.JSONDecodeError):
            return None

    return wait_for("new independent receiver process " + backend, ready)
