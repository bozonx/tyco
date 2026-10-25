"""Regression tests for VM isolation and protocol handling; no VM required."""

import io
import json
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from vmlib import Qmp, ResourceLock, StepFailed, Vm, wait_for
from webdriver import WebDriver


class ResourceLockTests(unittest.TestCase):
    def test_exclusive_lock_rejects_another_owner_and_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            first = ResourceLock(Path(directory), "port:2253")
            with self.assertRaises(StepFailed):
                ResourceLock(Path(directory), "port:2253")
            first.close()
            ResourceLock(Path(directory), "port:2253").close()

    def test_readers_share_a_base_but_block_a_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            first = ResourceLock(Path(directory), "base", shared=True)
            second = ResourceLock(Path(directory), "base", shared=True)
            with self.assertRaises(StepFailed):
                ResourceLock(Path(directory), "base")
            first.close()
            second.close()


class QmpTests(unittest.TestCase):
    def test_events_do_not_hide_command_errors(self):
        qmp = Qmp.__new__(Qmp)
        qmp.socket = Mock()
        with tempfile.TemporaryDirectory() as directory:
            qmp.log = Path(directory) / "events.jsonl"
            qmp.read = Mock(
                side_effect=[{"event": "STOP"}, {"error": {"desc": "denied"}}]
            )
            with self.assertRaisesRegex(StepFailed, "denied"):
                qmp.execute("input-send-event")
            self.assertEqual(json.loads(qmp.log.read_text())["event"], "STOP")

    def test_failed_key_press_releases_all_modifiers(self):
        qmp = Qmp.__new__(Qmp)
        qmp.execute = Mock(side_effect=[None, StepFailed("input failure"), None, None])
        with self.assertRaisesRegex(StepFailed, "input failure"):
            qmp.tap("ctrl", "i")
        calls = qmp.execute.call_args_list
        self.assertEqual(
            [call.kwargs["events"][0]["data"]["down"] for call in calls],
            [True, True, False, False],
        )
        self.assertEqual(calls[-1].kwargs["events"][0]["data"]["key"]["data"], "ctrl")

    def test_invalid_key_release_does_not_leave_control_pressed(self):
        qmp = Qmp.__new__(Qmp)
        qmp.execute = Mock(
            side_effect=[
                None,
                StepFailed("press failed"),
                StepFailed("release failed"),
                None,
            ]
        )
        with self.assertRaisesRegex(StepFailed, "press failed"):
            qmp.tap("ctrl", "invalid")
        last = qmp.execute.call_args_list[-1].kwargs["events"][0]["data"]
        self.assertFalse(last["down"])
        self.assertEqual(last["key"]["data"], "ctrl")


class PreflightTests(unittest.TestCase):
    def test_shared_base_writable_is_rejected_before_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = root / "base.qcow2"
            base.touch()
            key = root / "key"
            key.touch()
            profile = root / "vm.json"
            profile.write_text(
                json.dumps(
                    {
                        "base": str(base),
                        "ssh_key": str(key),
                        "ssh_port": 2253,
                        "user": "tester",
                    }
                )
            )
            vm = Vm(profile, root / "tyco", prepare=True)
            with (
                patch("vmlib.shutil.which", return_value="tool"),
                patch("vmlib.os.access", return_value=True),
            ):
                with self.assertRaisesRegex(StepFailed, "frozen read-only"):
                    vm.preflight()
            vm.stop()
            self.assertTrue(base.exists())

    def test_timeout_never_turns_a_missing_observation_into_success(self):
        with self.assertRaisesRegex(StepFailed, "Timed out"):
            wait_for("foreign text", lambda: False, timeout=0)


class WebDriverTests(unittest.TestCase):
    def test_application_error_payload_is_not_a_webdriver_protocol_error(self):
        payload = {"value": {"ok": False, "error": "AccessDenied"}}
        response = io.BytesIO(json.dumps(payload).encode())
        with patch("urllib.request.urlopen", return_value=response):
            result = WebDriver(4444).request("POST", "/execute/async", {})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "AccessDenied")

    def test_native_capture_error_state_is_application_data(self):
        payload = {
            "value": {"error": "Microphone disappeared", "bytes": 3200, "ended": False}
        }
        response = io.BytesIO(json.dumps(payload).encode())
        with patch("urllib.request.urlopen", return_value=response):
            result = WebDriver(4444).request("POST", "/execute/sync", {})
        self.assertEqual(result, payload["value"])

    def test_actual_webdriver_error_fails_the_check(self):
        payload = {"value": {"error": "no such window", "message": "gone"}}
        response = io.BytesIO(json.dumps(payload).encode())
        with patch("urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(StepFailed, "no such window"):
                WebDriver(4444).request("POST", "/window", {})


class VmCleanupTests(unittest.TestCase):
    def test_unresponsive_ssh_master_does_not_leave_a_child_process_or_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            profile = root / "profile.json"
            profile.write_text(
                json.dumps(
                    {
                        "base": str(root / "base.qcow2"),
                        "ssh_key": str(root / "key"),
                        "ssh_port": 2253,
                        "user": "tester",
                    }
                )
            )
            vm = Vm(profile, root / "stand", prepare=True)
            vm.sockets = root / "sockets"
            vm.sockets.mkdir()
            (vm.sockets / "ssh").touch()
            vm.locks.append(ResourceLock(root / "locks", "owned-vm"))
            child = subprocess.Popen(
                [sys.executable, "-c", "import time; time.sleep(60)"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            vm.process = child

            def poweroff(_command, timeout):
                child.terminate()
                return ""

            vm.ssh = poweroff
            try:
                with patch(
                    "vmlib.subprocess.run",
                    side_effect=subprocess.TimeoutExpired("ssh -O exit", 3),
                ):
                    vm.stop(keep=True)
                self.assertIsNotNone(
                    child.poll(), "Transport cleanup orphaned the owned process"
                )
                self.assertIsNone(vm.sockets)
                ResourceLock(root / "locks", "owned-vm").close()
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)


class EmbeddedJavaScriptTests(unittest.TestCase):
    def test_webdriver_scripts_parse_before_booting_a_vm(self):
        import ast
        import subprocess

        snippets = []
        for path in Path(__file__).parent.glob("*.py"):
            for node in ast.walk(ast.parse(path.read_text())):
                if isinstance(node, ast.Dict):
                    for key, value in zip(node.keys, node.values):
                        if (
                            isinstance(key, ast.Constant)
                            and key.value == "script"
                            and isinstance(value, ast.Constant)
                            and isinstance(value.value, str)
                        ):
                            snippets.append(
                                {
                                    "file": path.name,
                                    "line": value.lineno,
                                    "script": value.value,
                                }
                            )
                elif (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "execute"
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "driver"
                    and node.args
                    and isinstance(node.args[0], ast.Constant)
                    and isinstance(node.args[0].value, str)
                ):
                    snippets.append(
                        {
                            "file": path.name,
                            "line": node.lineno,
                            "script": node.args[0].value,
                        }
                    )
        self.assertTrue(snippets, "No embedded WebDriver scripts were collected")
        validator = "const fs=require('node:fs'); const scripts=JSON.parse(fs.readFileSync(0,'utf8')); const errors=[]; for(const item of scripts){try{new Function(item.script)}catch(error){errors.push({file:item.file,line:item.line,error:error.message})}} process.stdout.write(JSON.stringify(errors)); process.exitCode=errors.length?1:0;"
        result = subprocess.run(
            ["node", "-e", validator],
            input=json.dumps(snippets),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class UpgradeVersionTests(unittest.TestCase):
    def test_reinstall_or_downgrade_never_counts_as_upgrade(self):
        from package import validate_upgrade_versions

        for previous, current in (
            ("0.1.0", "0.1.0"),
            ("0.2.0", "0.1.0"),
            ("0.1.0+old", "0.1.0+new"),
            (None, "0.1.0"),
        ):
            with (
                self.subTest(previous=previous, current=current),
                self.assertRaises(StepFailed),
            ):
                validate_upgrade_versions(previous, current)

    def test_real_version_precedence_including_prereleases(self):
        from package import validate_upgrade_versions

        for previous, current in (
            ("0.0.9", "0.1.0"),
            ("0.1.0-rc.2", "0.1.0-rc.10"),
            ("0.1.0-rc.10", "0.1.0"),
        ):
            with self.subTest(previous=previous, current=current):
                validate_upgrade_versions(previous, current)


class RunnerSnapshotTests(unittest.TestCase):
    def test_running_scenarios_keep_their_original_bytes_after_source_edits(self):
        from run import snapshot_runner

        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source"
            source.mkdir()
            script = source / "scenario.py"
            script.write_text("ORIGINAL = True\n")
            snapshot = Path(temporary) / "snapshot"
            hashes = snapshot_runner(source, snapshot)
            script.write_text("ORIGINAL = False\n")
            self.assertEqual((snapshot / script.name).read_text(), "ORIGINAL = True\n")
            self.assertEqual(
                hashes[script.name],
                __import__("hashlib").sha256(b"ORIGINAL = True\n").hexdigest(),
            )


class RequestedScopeTests(unittest.TestCase):
    def test_isolation_selects_only_requested_groups_and_never_a_typo(self):
        from run import requested_isolated_cases

        self.assertEqual(requested_isolated_cases("VM-16.reboot"), ["VM-16.reboot"])
        self.assertEqual(len(requested_isolated_cases("VM-16")), 4)
        self.assertEqual(requested_isolated_cases("VM-16.typo"), [])

    def test_unknown_target_cannot_pass_only_bootstrap_checks(self):
        from run import unmatched_requests

        checks = [{"id": "VM-01.startup"}, {"id": "VM-03.allow"}]
        self.assertEqual(unmatched_requests("VM-16.typo", checks), ["VM-16.typo"])

    def test_group_matches_children_but_not_similar_prefixes(self):
        from run import unmatched_requests

        checks = [{"id": "VM-16.reboot"}, {"id": "VM-01.startup"}]
        self.assertEqual(
            unmatched_requests("VM-16,VM-1,VM-16.reboot", checks), ["VM-1"]
        )


if __name__ == "__main__":
    unittest.main()
