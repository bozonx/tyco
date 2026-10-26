"""Regression tests for VM isolation and protocol handling; no VM required."""

import http.client
import io
import json
import shutil
import signal
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from vmlib import Qmp, ResourceLock, StepFailed, Vm, run_isolated, wait_for
from webdriver import WebDriver
from media import capture_client_indexes
from monitors import output_settings_match
from accessibility import application_nodes
from wallet import WalletFixture


class AccessibilityTests(unittest.TestCase):
    def test_disconnected_applications_do_not_hide_live_controls(self):
        stale = Mock()
        stale.get_name.side_effect = RuntimeError("Application disconnected")
        live = Mock()
        live.get_name.return_value = "ksecretd"
        desktop = Mock()
        desktop.get_child_count.return_value = 3
        desktop.get_child_at_index.side_effect = [None, stale, live]
        self.assertEqual(list(application_nodes(desktop)), [(live, "ksecretd")])


class WalletFixtureTests(unittest.TestCase):
    def test_checkpoint_locks_the_provider_before_unlock_and_independent_read(self):
        guest = Mock(
            side_effect=[
                json.dumps({"data": ["/collection/test"]}),
                "",
                json.dumps({"data": True}),
            ]
        )
        wallet = WalletFixture(guest)
        wallet.assert_available = Mock(return_value={"byteCount": 37})
        self.assertEqual(
            wallet.checkpoint(Mock(), "fixture", "value"), {"byteCount": 37}
        )
        self.assertIn(" Lock ao 1 /collection/test", guest.call_args_list[1].args[0])
        wallet.assert_available.assert_called_once()


class MonitorConfigurationTests(unittest.TestCase):
    def test_successful_cli_exit_does_not_certify_an_ignored_layout(self):
        stale = [
            {"id": 1, "scale": 1, "pos": {"x": 0, "y": 0}, "priority": 1},
            {"id": 2, "scale": 2, "pos": {"x": 1920, "y": 0}, "priority": 2},
        ]
        desired = {
            "1": {"scale": 1, "pos": {"x": 1280, "y": 0}, "priority": 2},
            "2": {"scale": 1.5, "pos": {"x": 0, "y": 0}, "priority": 1},
        }
        self.assertFalse(output_settings_match(stale, desired))
        actual = [
            {"id": int(identifier), **settings}
            for identifier, settings in desired.items()
        ]
        self.assertTrue(output_settings_match(actual, desired))
        actual[1]["priority"] = 2
        self.assertFalse(output_settings_match(actual, desired))


class AudioClientTests(unittest.TestCase):
    def test_loopback_and_existing_clients_are_not_app_capture_leaks(self):
        outputs = [
            {"index": 12, "owner_module": None},
            {"index": 80, "owner_module": "536870917"},
            {"index": 81, "properties": {"pulse.module.id": "536870917"}},
            {"index": 91, "owner_module": None},
        ]
        self.assertEqual(capture_client_indexes(outputs, {12}, {"536870917"}), {91})
        self.assertEqual(
            capture_client_indexes(outputs[:-1], {12}, {"536870917"}), set()
        )

    def test_a_new_recorder_without_a_module_still_counts_as_a_leak(self):
        self.assertEqual(
            capture_client_indexes(
                [{"index": 92, "owner_module": None}], set(), {"536870917"}
            ),
            {92},
        )


class IsolatedRunTests(unittest.TestCase):
    def child(self, responses):
        process = Mock()
        process.pid = 88123
        process.returncode = 0
        process.communicate.side_effect = responses
        context = Mock()
        context.__enter__ = Mock(return_value=process)
        context.__exit__ = Mock(return_value=False)
        return process, context

    def test_normal_child_keeps_output_and_exit_status(self):
        process, context = self.child([("output", "diagnostics")])
        process.returncode = 1
        with (
            tempfile.TemporaryDirectory() as directory,
            patch("vmlib.subprocess.Popen", return_value=context) as start,
        ):
            path = Path(directory) / "child.log"
            result = run_isolated(["child"], path)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(path.read_text(), "outputdiagnostics")
            self.assertTrue(start.call_args.kwargs["start_new_session"])

    def test_interrupt_waits_for_teardown_before_propagating(self):
        process, context = self.child([KeyboardInterrupt(), ("child teardown", "")])
        with (
            tempfile.TemporaryDirectory() as directory,
            patch("vmlib.subprocess.Popen", return_value=context),
        ):
            path = Path(directory) / "child.log"
            with self.assertRaisesRegex(KeyboardInterrupt, "after child teardown"):
                run_isolated(["child"], path)
            process.send_signal.assert_called_once_with(signal.SIGINT)
            self.assertEqual(process.communicate.call_count, 2)
            self.assertEqual(path.read_text(), "child teardown")

    def test_real_interrupt_reaps_the_isolated_process(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ready = root / "ready"
            log = root / "child.log"
            child = (
                "import os,signal,sys,time; from pathlib import Path; signal.signal(signal.SIGINT,lambda *_:(print('child stopped',flush=True),sys.exit(0))); Path("
                + repr(str(ready))
                + ").write_text(str(os.getpid())); time.sleep(60)"
            )
            helper = (
                "import sys; sys.path.insert(0,"
                + repr(str(Path(__file__).parent))
                + "); from pathlib import Path; from vmlib import run_isolated; run_isolated([sys.executable,'-c',"
                + repr(child)
                + "],Path("
                + repr(str(log))
                + "))"
            )
            process = subprocess.Popen(
                [sys.executable, "-c", helper],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,
            )
            try:
                wait_for("isolated child ready", ready.exists, timeout=5, interval=0.02)
                child_pid = int(ready.read_text())
                process.send_signal(signal.SIGINT)
                process.communicate(timeout=10)
                self.assertNotEqual(process.returncode, 0)
                self.assertIn("child stopped", log.read_text())
                with self.assertRaises(ProcessLookupError):
                    import os

                    os.kill(child_pid, 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate(timeout=5)

    def test_hung_cleanup_terminates_only_the_child_process_group(self):
        process, context = self.child(
            [
                KeyboardInterrupt(),
                subprocess.TimeoutExpired("child", 180),
                ("terminated", ""),
            ]
        )
        with (
            tempfile.TemporaryDirectory() as directory,
            patch("vmlib.subprocess.Popen", return_value=context),
            patch("vmlib.os.killpg") as terminate,
        ):
            with self.assertRaises(KeyboardInterrupt):
                run_isolated(["child"], Path(directory) / "child.log")
            terminate.assert_called_once_with(process.pid, signal.SIGTERM)


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

    def test_unobserved_guest_delivery_fails_and_releases_the_chord(self):
        qmp = Qmp.__new__(Qmp)
        qmp.execute = Mock()
        qmp.observe_keys = Mock(side_effect=StepFailed("No guest key event"))
        with self.assertRaisesRegex(StepFailed, "No guest key event"):
            qmp.tap("ctrl", "i")
        transitions = [
            call.kwargs["events"][0]["data"]["down"]
            for call in qmp.execute.call_args_list
        ]
        self.assertEqual(transitions, [True, True, False, False])
        qmp.observe_keys.assert_called_once_with(("ctrl", "i"), True)

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
    def test_start_observes_window_readiness_before_configuring_timeouts(self):
        driver = WebDriver(4444)
        observed = []
        driver.request = Mock(return_value={"sessionId": "fixture"})
        driver.window = Mock(side_effect=lambda *args: observed.append("ready"))
        driver.call = Mock(side_effect=lambda *args: observed.append("timeouts"))
        driver.execute = Mock(return_value="tauri://localhost")
        driver.start("/fixture/tyco")
        self.assertEqual(observed, ["ready", "timeouts"])
        driver.request.assert_called_once()

    def test_window_discovery_polls_a_disconnected_read_without_restarting(self):
        driver = WebDriver(4444)
        driver.session = "existing-session"
        driver.call = Mock(
            side_effect=[http.client.RemoteDisconnected("closed"), ["main"], None]
        )
        driver.execute = Mock(return_value=True)
        self.assertEqual(driver.window("main", ".cm-editor"), "main")
        self.assertEqual(driver.session, "existing-session")
        self.assertEqual(len(driver.read_disconnects), 1)
        self.assertEqual(
            [call.args[0] for call in driver.call.call_args_list],
            ["GET", "GET", "POST"],
        )

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


class LlmStubTests(unittest.TestCase):
    """The loopback model answers what the scenario set, in both API modes."""

    def setUp(self):
        import socket
        import time
        import urllib.request

        self.urlopen = urllib.request.urlopen
        self.Request = urllib.request.Request
        self.work = Path(tempfile.mkdtemp())
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        (self.work / "llm-stub-reply.json").write_text(json.dumps({"text": "Fixed"}))
        self.server = subprocess.Popen(
            [
                sys.executable,
                str(Path(__file__).with_name("llm-stub.py")),
                str(self.work),
                str(self.port),
            ]
        )
        self.addCleanup(shutil.rmtree, self.work)
        self.addCleanup(self.stop_server)
        for _ in range(100):
            try:
                self.urlopen(self.url("/v1/models"), timeout=1)
                return
            except OSError:
                time.sleep(0.05)
        self.fail("LLM stub did not start")

    def stop_server(self):
        self.server.terminate()
        try:
            self.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.server.kill()
            self.server.wait(timeout=5)

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def post(self, body):
        request = self.Request(
            self.url("/v1/chat/completions"),
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        return self.urlopen(request, timeout=5).read().decode()

    def test_plain_and_streamed_answers_are_logged(self):
        plain = json.loads(
            self.post({"model": "m", "messages": [{"role": "user", "content": "Ths"}]})
        )
        self.assertEqual(plain["choices"][0]["message"]["content"], "Fixed")
        stream = self.post({"model": "m", "stream": True, "messages": []})
        chunks = [
            json.loads(line[len("data: ") :])
            for line in stream.splitlines()
            if line.startswith("data: {")
        ]
        self.assertEqual(
            "".join(c["choices"][0]["delta"].get("content", "") for c in chunks),
            "Fixed",
        )
        self.assertEqual(chunks[-1]["choices"][0]["finish_reason"], "stop")
        self.assertTrue(stream.rstrip().endswith("data: [DONE]"))
        requests = (self.work / "llm-stub-requests.jsonl").read_text().splitlines()
        self.assertEqual(len(requests), 2)
        self.assertIn("Ths", requests[0])


if __name__ == "__main__":
    unittest.main()
