"""Tyco disposable Linux VM infrastructure.

Design reference: Left Hand Control apps/slint-shell/scripts/vm/vmlib.py.
This implementation has independent paths, locks, networking and reports and
never imports or changes the adjacent project's configuration or images.
"""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]


class StepFailed(RuntimeError):
    pass


def run(argv, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise StepFailed(
            f"{argv[0]} exited {result.returncode}: {result.stderr[-4000:]}"
        )
    return result.stdout


def run_isolated(argv, log):
    """Keep an interrupted parent alive until its disposable child is stopped."""
    with subprocess.Popen(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    ) as process:
        interrupted = False
        try:
            stdout, stderr = process.communicate()
        except KeyboardInterrupt:
            interrupted = True
            process.send_signal(signal.SIGINT)
            try:
                stdout, stderr = process.communicate(timeout=180)
            except subprocess.TimeoutExpired:
                # The child owns this process group, including its QEMU/SSH
                # descendants. Never signal the parent's or user's group.
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    stdout, stderr = process.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    stdout, stderr = process.communicate()
        log.write_text(stdout + stderr)
        if interrupted:
            raise KeyboardInterrupt("Isolated VM run interrupted after child teardown")
        return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)


def wait_for(label, probe, timeout=60, interval=0.25):
    deadline = time.monotonic() + timeout
    while True:
        value = probe()
        if value:
            return value
        if time.monotonic() >= deadline:
            raise StepFailed(f"Timed out waiting for {label}")
        time.sleep(interval)


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class ResourceLock:
    def __init__(self, directory, name, shared=False):
        directory.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(str(name).encode()).hexdigest()
        self.stream = (directory / f"{key}.lock").open("a")
        try:
            fcntl.flock(
                self.stream,
                (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB,
            )
        except BlockingIOError as error:
            self.stream.close()
            raise StepFailed(f"Resource already in use: {name}") from error

    def close(self):
        self.stream.close()


class Qmp:
    def __init__(self, path, process, log):
        self.process = process
        self.log = log
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.settimeout(15)

        def connect():
            if process.poll() is not None:
                raise StepFailed("QEMU exited before QMP; see qemu.log")
            try:
                self.socket.connect(str(path))
                return True
            except (FileNotFoundError, ConnectionRefusedError):
                return False

        wait_for("QMP", connect, timeout=30)
        self.reader = self.socket.makefile("rb")
        self.read()
        self.execute("qmp_capabilities")

    def read(self):
        line = self.reader.readline()
        if not line:
            raise StepFailed("QMP connection closed")
        return json.loads(line)

    def execute(self, command, **arguments):
        self.socket.sendall(
            json.dumps({"execute": command, "arguments": arguments}).encode() + b"\n"
        )
        while True:
            reply = self.read()
            if "event" in reply:
                with self.log.open("a") as stream:
                    stream.write(json.dumps(reply) + "\n")
            elif "error" in reply:
                raise StepFailed(f"QMP {command}: {reply['error']}")
            elif "return" in reply:
                return reply["return"]

    def tap(self, *keys):
        # Explicit releases also run when an injection fails partway through.
        attempted = []
        try:
            for key in keys:
                attempted.append(key)
                self.execute(
                    "input-send-event",
                    events=[
                        {
                            "type": "key",
                            "data": {
                                "down": True,
                                "key": {"type": "qcode", "data": key},
                            },
                        }
                    ],
                )
            # A guest observer confirms USB delivery before release when available.
            if getattr(self, "observe_keys", None):
                self.observe_keys(keys, True)
            time.sleep(0.12)
        finally:
            had_failure = sys.exc_info()[0] is not None
            release_errors = []
            for key in reversed(attempted):
                try:
                    self.execute(
                        "input-send-event",
                        events=[
                            {
                                "type": "key",
                                "data": {
                                    "down": False,
                                    "key": {"type": "qcode", "data": key},
                                },
                            }
                        ],
                    )
                except (OSError, StepFailed) as error:
                    release_errors.append(error)
            if release_errors and not had_failure:
                raise release_errors[0]
            if getattr(self, "observe_keys", None) and not had_failure:
                self.observe_keys(keys, False)
            else:
                time.sleep(0.12)

    def screenshot(self, path):
        self.execute("screendump", filename=str(path), format="png")

    def close(self):
        self.reader.close()
        self.socket.close()


class Vm:
    def __init__(self, profile, directory, prepare=False, resume_prepare=None):
        self.profile = Path(profile).resolve()
        self.config = json.loads(self.profile.read_text())
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.original_base = Path(self.config["base"]).expanduser().resolve()
        self.prepared = self.directory / "prepared.qcow2"
        self.base = self.original_base if prepare else self.prepared
        self.key = Path(self.config["ssh_key"]).expanduser().resolve()
        self.port = int(self.config["ssh_port"])
        self.user = self.config["user"]
        self.run_dir = (
            self.directory
            / "runs"
            / (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
        )
        self.run_dir.mkdir(parents=True)
        self.overlay = self.run_dir / "run.qcow2"
        self.process = None
        self.qmp = None
        self.sockets = None
        self.locks = []
        self.machine = self.config.get("machine", "q35")
        self.extra_display = False
        self.prepare = prepare
        self.resume_prepare = resume_prepare

    def preflight(self):
        missing = [
            name
            for name in ("qemu-system-x86_64", "qemu-img", "ssh", "scp")
            if not shutil.which(name)
        ]
        if missing:
            raise StepFailed(f"Missing host tools: {', '.join(missing)}")
        if not os.access("/dev/kvm", os.R_OK | os.W_OK):
            raise StepFailed(
                "/dev/kvm is unavailable; run on the KVM host outside the sandbox"
            )
        if not self.base.is_file():
            raise StepFailed(f"Missing {self.base}; first run --suite prepare")
        if not self.key.is_file():
            raise StepFailed(f"Missing SSH key: {self.key}")
        if self.original_base.stat().st_mode & 0o222:
            raise StepFailed("The shared original base must be frozen read-only")
        if shutil.disk_usage(self.directory).free < 8 * 1024**3:
            raise StepFailed(
                "At least 8 GiB free space is required for the disposable overlay"
            )
        lock_dir = Path(tempfile.gettempdir()) / f"tyco-vm-locks-{os.getuid()}"
        for resource, shared in (
            (self.directory, False),
            (f"port:{self.port}", False),
            (self.original_base, True),
        ):
            self.locks.append(ResourceLock(lock_dir, resource, shared))
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(("127.0.0.1", self.port))
        if not self.prepare:
            manifest = json.loads((self.directory / "prepared.json").read_text())
            stat = self.original_base.stat()
            if (
                manifest["base"] != str(self.original_base)
                or manifest["baseSize"] != stat.st_size
                or manifest["baseMtimeNs"] != stat.st_mtime_ns
            ):
                raise StepFailed(
                    "The original base changed since preparation; prepare a new stand"
                )
            if manifest["profileSha256"] != sha256(self.profile):
                raise StepFailed("The VM profile changed since preparation")
            if manifest["guestSha256"] != sha256(Path(__file__).with_name("guest.py")):
                raise StepFailed("Guest preparation changed; prepare the stand again")

    def start(self, show=False):
        self.preflight()
        self.sockets = Path(tempfile.mkdtemp(prefix="tyco-vm-"))
        if self.resume_prepare:
            previous = Path(self.resume_prepare).resolve()
            if not self.prepare or previous.parent != self.directory / "runs":
                raise StepFailed(
                    "Only a failed preparation from this stand may be resumed"
                )
            report = json.loads((previous / "report.json").read_text())
            if report["suite"] != "prepare" or report["result"] != "FAIL":
                raise StepFailed(
                    "Resume requires a completed failed preparation report"
                )
            image = previous / "run.qcow2"
            info = json.loads(run(["qemu-img", "info", "--output=json", str(image)]))
            if info.get("full-backing-filename") != str(self.original_base):
                raise StepFailed(
                    "Failed preparation does not reference the expected original base"
                )
            image.rename(self.overlay)
        else:
            run(
                [
                    "qemu-img",
                    "create",
                    "-q",
                    "-f",
                    "qcow2",
                    "-F",
                    "qcow2",
                    "-b",
                    str(self.base),
                    str(self.overlay),
                ]
            )
        # Preparation alone can access package mirrors. Test boots use SLIRP's
        # restrict mode in addition to the guest firewall; no shared clipboard.
        net = f"user,id=net0,hostfwd=tcp:127.0.0.1:{self.port}-:22"
        if not self.prepare:
            net += ",restrict=on"
        argv = [
            "qemu-system-x86_64",
            "-name",
            f"tyco-test-{self.config['name']}",
            "-machine",
            f"{self.machine},accel=kvm",
            "-cpu",
            "host",
            "-smp",
            str(self.config.get("cpus", 4)),
            "-m",
            str(self.config.get("memory", 4096)),
            "-drive",
            f"file={self.overlay},if=virtio,format=qcow2,discard=unmap",
            "-device",
            "qemu-xhci",
            "-device",
            "usb-tablet,port=1",
            "-device",
            "usb-kbd,port=2",
            "-vga",
            "none",
            "-device",
            self.config.get("vga", "VGA"),
            "-device",
            "virtio-rng-pci",
            "-netdev",
            net,
            "-device",
            "virtio-net-pci,netdev=net0",
            "-qmp",
            f"unix:{self.sockets / 'qmp'},server=on,wait=off",
            "-display",
            "gtk,gl=off" if show else "none",
        ]
        if self.extra_display:
            argv.extend(["-device", "secondary-vga,id=tyco-vm-secondary"])
        (self.run_dir / "qemu-command.json").write_text(
            json.dumps(argv, indent=2) + "\n"
        )
        with (self.run_dir / "qemu.log").open("w") as log:
            self.process = subprocess.Popen(argv, stdout=log, stderr=log)
        self.qmp = Qmp(
            self.sockets / "qmp", self.process, self.run_dir / "qmp-events.jsonl"
        )
        self.qmp.execute("query-status")

    def ssh_options(self, multiplex=True):
        controls = (
            []
            if not multiplex or not self.sockets
            else [
                "-o",
                "ControlMaster=auto",
                "-o",
                "ControlPersist=30",
                "-o",
                f"ControlPath={self.sockets / 'ssh'}",
            ]
        )
        return [
            *(
                controls
                if multiplex
                else ["-o", "ControlMaster=no", "-o", "ControlPath=none"]
            ),
            "-i",
            str(self.key),
            "-o",
            "BatchMode=yes",
            "-o",
            "ForwardAgent=no",
            "-o",
            "ForwardX11=no",
            "-o",
            "RequestTTY=no",
            "-o",
            "ConnectTimeout=5",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            f"UserKnownHostsFile={self.directory / 'known_hosts'}",
            "-o",
            "LogLevel=ERROR",
        ]

    def ssh(self, command, timeout=120):
        return run(
            [
                "ssh",
                *self.ssh_options(),
                "-p",
                str(self.port),
                f"{self.user}@127.0.0.1",
                command,
            ],
            timeout=timeout,
        )

    def wait_ssh(self):
        def ready():
            if self.process.poll() is not None:
                raise StepFailed("QEMU exited; see qemu.log")
            try:
                return self.ssh("true", timeout=10) is not None
            except (StepFailed, subprocess.TimeoutExpired):
                return False

        wait_for("SSH", ready, timeout=240, interval=2)

    def copy_to(self, source, destination):
        run(
            [
                "scp",
                *self.ssh_options(),
                "-P",
                str(self.port),
                str(source),
                f"{self.user}@127.0.0.1:{destination}",
            ],
            timeout=180,
        )

    def copy_from(self, source, destination):
        run(
            [
                "scp",
                *self.ssh_options(),
                "-P",
                str(self.port),
                "-r",
                f"{self.user}@127.0.0.1:{source}",
                str(destination),
            ],
            timeout=120,
        )

    def stop(self, keep=False):
        try:
            if self.process and self.process.poll() is None:
                try:
                    try:
                        self.ssh("sudo -n systemctl poweroff", timeout=10)
                    except (OSError, StepFailed, subprocess.TimeoutExpired):
                        if self.qmp:
                            self.qmp.execute("system_powerdown")
                    self.process.wait(timeout=45)
                except (OSError, StepFailed, subprocess.TimeoutExpired):
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
                        self.process.wait(timeout=10)
        finally:
            # Transport cleanup must never leave an owned QEMU process alive.
            if self.process and self.process.poll() is None:
                self.process.kill()
                self.process.wait(timeout=10)
            if self.sockets and (self.sockets / "ssh").exists():
                try:
                    subprocess.run(
                        [
                            "ssh",
                            *self.ssh_options(),
                            "-p",
                            str(self.port),
                            "-O",
                            "exit",
                            f"{self.user}@127.0.0.1",
                        ],
                        capture_output=True,
                        timeout=3,
                    )
                except (OSError, subprocess.TimeoutExpired):
                    pass
            try:
                if self.qmp:
                    self.qmp.close()
                    self.qmp = None
                if self.sockets:
                    shutil.rmtree(self.sockets)
                    self.sockets = None
                if not keep:
                    self.overlay.unlink(missing_ok=True)
            finally:
                for lock in self.locks:
                    lock.close()
                self.locks.clear()
        return self.process is None or self.process.returncode == 0
