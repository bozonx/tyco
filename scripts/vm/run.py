#!/usr/bin/env python3
"""Prepare or run independent, disposable Tyco Fedora KDE VM tests."""

import argparse
import hashlib
import json
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import sys
import time
import traceback

from vmlib import ROOT, StepFailed, Vm, run, sha256, wait_for
from webdriver import WebDriver

SCRIPTS = Path(__file__).resolve().parent
ISOLATED_CASES = (
    "VM-03.cancel",
    "VM-16.lock-unlock",
    "VM-16.suspend-resume",
    "VM-16.logout-login",
    "VM-16.reboot",
)


def source_identity():
    diff = run(["git", "diff", "HEAD", "--binary"], cwd=ROOT)
    status = run(["git", "status", "--porcelain"], cwd=ROOT)
    untracked = run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).split("\0")
    return {
        "commit": run(["git", "rev-parse", "HEAD"], cwd=ROOT).strip(),
        "status": status,
        "diffSha256": hashlib.sha256(diff.encode()).hexdigest(),
        "untracked": {
            name: sha256(ROOT / name)
            for name in untracked
            if name and (ROOT / name).is_file()
        },
    }


def snapshot_runner(source, destination):
    destination.mkdir(parents=True)
    for path in source.iterdir():
        if path.is_file() and path.suffix in (".py", ".js", ".ts"):
            shutil.copy2(path, destination / path.name)
            (destination / path.name).chmod(0o444)
    return {path.name: sha256(path) for path in sorted(destination.iterdir())}


def requested_isolated_cases(requested):
    return [
        case
        for case in ISOLATED_CASES
        if not requested
        or any(
            case == request or case.startswith(request + ".")
            for request in requested.split(",")
        )
    ]


def unmatched_requests(requested, checks):
    observed = [check["id"] for check in checks]
    return [
        request
        for request in requested.split(",")
        if not any(
            identifier == request or identifier.startswith(request + ".")
            for identifier in observed
        )
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--profile", type=Path, default=SCRIPTS / "profiles/fedora44-kde.json"
    )
    parser.add_argument("--vm", type=Path, default=ROOT / "dev_files/vm/fedora44-kde")
    parser.add_argument(
        "--suite", choices=("prepare", "smoke", "native", "package"), default="smoke"
    )
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--ctl", type=Path)
    parser.add_argument(
        "--previous-artifact",
        type=Path,
        help="Actual older release AppImage for package upgrade acceptance",
    )
    parser.add_argument(
        "--driver", type=Path, default=ROOT / "dev_files/vm/tools/tauri-driver"
    )
    parser.add_argument(
        "--only",
        help="Comma-separated native subcase IDs; targeted run, not full acceptance",
    )
    parser.add_argument("--cycles", type=int, default=20)
    parser.add_argument(
        "--resume-prepare",
        type=Path,
        help="Resume a stopped failed preparation run from this stand",
    )
    parser.add_argument(
        "--hold-on-failure",
        action="store_true",
        help="Keep the failed guest running until Enter (interactive diagnostics)",
    )
    parser.add_argument(
        "--isolated-portal-cancel", action="store_true", help=argparse.SUPPRESS
    )
    parser.add_argument("--isolated-case", help=argparse.SUPPRESS)
    parser.add_argument("--show", action="store_true")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()
    if args.only and args.suite != "native":
        parser.error(
            "--only requires native suite; package installation/removal runs as one lifecycle"
        )
    if args.isolated_portal_cancel:
        args.isolated_case = "VM-03.cancel"
    if not args.isolated_case and args.only in ISOLATED_CASES:
        args.isolated_case = args.only
    if args.isolated_case and (
        args.suite != "native"
        or args.only != args.isolated_case
        or args.isolated_case not in ISOLATED_CASES
    ):
        parser.error("An isolated case requires its exact native --only ID")
    args.isolated_portal_cancel = args.isolated_case == "VM-03.cancel"
    if args.resume_prepare and args.suite != "prepare":
        parser.error("--resume-prepare requires --suite prepare")
    if args.cycles < 20:
        parser.error("--cycles must be at least 20 for hotkey/focus acceptance")
    if args.suite != "prepare" and (not args.artifact or not args.artifact.is_file()):
        parser.error("--artifact must name an embedded-assets executable or AppImage")
    if args.previous_artifact and (
        args.suite != "package"
        or not args.previous_artifact.is_file()
        or args.previous_artifact.suffix != ".AppImage"
    ):
        parser.error(
            "--previous-artifact requires an existing AppImage and --suite package"
        )
    if args.suite == "package" and args.artifact.suffix != ".AppImage":
        parser.error("Fedora package acceptance requires an AppImage")
    vm = Vm(
        args.profile,
        args.vm,
        prepare=args.suite == "prepare",
        resume_prepare=args.resume_prepare,
    )
    scripts = vm.run_dir / "runner"
    runner_hashes = snapshot_runner(SCRIPTS, scripts)
    # Later imports and guest fixtures use these immutable per-run copies.
    sys.path.insert(0, str(scripts))
    report = {
        "suite": args.suite,
        "scope": "targeted" if args.only else "suite",
        "requestedChecks": args.only,
        "profile": vm.config,
        "source": source_identity(),
        "runnerSha256": runner_hashes,
        "command": sys.argv,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "checks": [],
    }
    if args.artifact:
        report["artifact"] = {
            "path": str(args.artifact.resolve()),
            "sha256": sha256(args.artifact),
        }
    if args.previous_artifact:
        previous_hash = sha256(args.previous_artifact)
        if previous_hash == report["artifact"]["sha256"]:
            parser.error("Upgrade requires two different real release artifacts")
        report["previousArtifact"] = {
            "path": str(args.previous_artifact.resolve()),
            "sha256": previous_hash,
        }
    if args.ctl:
        report["cli"] = {"path": str(args.ctl.resolve()), "sha256": sha256(args.ctl)}
    driver = None
    forward = None
    prepared = False
    failed = False

    def record(identifier, status, detail):
        report["checks"].append({"id": identifier, "status": status, "detail": detail})
        print(f"{identifier}: {status}: {detail}", flush=True)
        (vm.run_dir / "report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n"
        )

    def guest(action, timeout=120):
        if action.startswith("env-run "):
            action = action.replace("env-run ", "env-run -- ", 1)
        return vm.ssh(f"python3 tyco-vm/guest.py {action}", timeout=timeout)

    def session_ready():
        try:
            return json.loads(guest("session", timeout=15))
        except (StepFailed, subprocess.TimeoutExpired):
            return None

    def setup_services():
        vm.ssh(
            "pkill -x tauri-driver 2>/dev/null || true; pkill -x WebKitWebDriver 2>/dev/null || true"
        )
        guest(
            "env-run systemctl --user set-environment QT_QUICK_BACKEND=software LIBGL_ALWAYS_SOFTWARE=1 QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1"
        )
        guest(
            "env-run systemctl --user restart plasma-xdg-desktop-portal-kde.service xdg-desktop-portal.service"
        )
        vm.ssh(
            "sudo systemctl reset-failed tyco-vm-ydotool.service && sudo systemctl restart tyco-vm-ydotool.service"
        )
        report["environment"] = json.loads(guest("inventory"))
        if not report["environment"]["ydotoolSocket"]:
            raise StepFailed("The private ydotoold socket is not ready")
        vm.ssh(
            "WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 python3 tyco-vm/guest.py driver"
        )
        report["graphicsEnvironment"] = {
            "WEBKIT_DISABLE_DMABUF_RENDERER": "1",
            "LIBGL_ALWAYS_SOFTWARE": "1",
            "QT_QUICK_BACKEND": "software",
            "QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1",
        }

    def connect_driver():
        nonlocal driver, forward
        if forward and forward.poll() is None:
            forward.terminate()
            forward.wait(timeout=10)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        with (vm.run_dir / "ssh-forward.log").open("a") as log:
            forward = subprocess.Popen(
                [
                    "ssh",
                    *vm.ssh_options(multiplex=False),
                    "-p",
                    str(vm.port),
                    "-o",
                    "ExitOnForwardFailure=yes",
                    "-N",
                    "-L",
                    f"127.0.0.1:{port}:127.0.0.1:4444",
                    f"{vm.user}@127.0.0.1",
                ],
                stdout=log,
                stderr=log,
            )
        driver = WebDriver(port)

        def driver_ready():
            try:
                return driver.request("GET", "/status")
            except (OSError, StepFailed):
                return None

        wait_for("tauri-driver", driver_ready, timeout=30)

    def ensure_driver_transport():
        nonlocal driver
        if forward and forward.poll() is not None:
            session_id = driver.session
            connect_driver()
            driver.session = session_id
            report.setdefault("transportReattachments", []).append(
                {
                    "sessionId": session_id,
                    "applicationPids": vm.ssh("pgrep -x tyco || true").split(),
                    "bootId": vm.ssh("cat /proc/sys/kernel/random/boot_id").strip(),
                }
            )
        return driver

    def setup_observer():
        vm.ssh(
            "python3 tyco-vm/guest.py env-run -- systemctl --user stop tyco-vm-observer.service tyco-vm-bus-monitor.service 2>/dev/null || true"
        )
        guest(
            "env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s tyco-vm-observer"
        )
        guest(
            f"env-run systemd-run --user --quiet --collect --unit=tyco-vm-bus-monitor --property=StandardOutput=append:/home/{vm.user}/tyco-vm/kwin-dbus.log dbus-monitor --session interface=org.tyco.KwinTracker"
        )
        guest(
            f"env-run systemd-run --user --quiet --collect --unit=tyco-vm-observer python3 /home/{vm.user}/tyco-vm/observer.py"
        )
        vm.ssh("rm -f tyco-vm/windows.json")

        def observer_ready():
            try:
                return "Observe" in guest(
                    "env-run busctl --user introspect org.tyco.VmObserver /org/tyco/VmObserver org.tyco.VmObserver"
                )
            except (StepFailed, subprocess.TimeoutExpired):
                return False

        wait_for("independent observer D-Bus object", observer_ready, timeout=20)
        observer = guest(
            f"env-run busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss /home/{vm.user}/tyco-vm/observer.js tyco-vm-observer"
        )
        observer_id = int(observer.split()[-1])
        guest(
            f"env-run busctl --user call org.kde.KWin /Scripting/Script{observer_id} org.kde.kwin.Script run"
        )

        def observed_windows():
            try:
                return isinstance(
                    json.loads(vm.ssh("cat tyco-vm/windows.json", timeout=5)).get(
                        "windows"
                    ),
                    list,
                )
            except (StepFailed, subprocess.TimeoutExpired, json.JSONDecodeError):
                return False

        wait_for(
            "initial independent KWin window inventory", observed_windows, timeout=20
        )

    def recover_controls():
        vm.wait_ssh()
        wait_for(
            "restored unlocked KDE Wayland session",
            session_ready,
            timeout=180,
            interval=2,
        )
        guest("offline")
        setup_services()
        connect_driver()
        setup_observer()
        driver.start(f"/home/{vm.user}/tyco-vm/{application}")
        report.setdefault("restoredEnvironments", []).append(
            json.loads(guest("inventory"))
        )
        return driver

    try:
        print(f"Artifacts: {vm.run_dir}", flush=True)
        if args.suite == "native" and not args.isolated_case:
            for identifier in requested_isolated_cases(args.only):
                command = [
                    sys.executable,
                    str(SCRIPTS / "run.py"),
                    "--suite",
                    "native",
                    "--only",
                    identifier,
                    "--isolated-case",
                    identifier,
                    "--profile",
                    str(args.profile.resolve()),
                    "--vm",
                    str(vm.directory),
                    "--artifact",
                    str(args.artifact.resolve()),
                    "--driver",
                    str(args.driver.resolve()),
                ]
                if args.ctl:
                    command.extend(["--ctl", str(args.ctl.resolve())])
                if args.keep:
                    command.append("--keep")
                child = subprocess.run(command, capture_output=True, text=True)
                log_name = "isolated-" + identifier + ".log"
                (vm.run_dir / log_name).write_text(child.stdout + child.stderr)
                directories = [
                    line.removeprefix("Artifacts: ")
                    for line in child.stdout.splitlines()
                    if line.startswith("Artifacts: ")
                ]
                if not directories:
                    record(
                        identifier,
                        "BLOCKED",
                        "Isolated runner produced no report; see " + log_name,
                    )
                    continue
                child_report_path = Path(directories[0]) / "report.json"
                child_report = json.loads(child_report_path.read_text())
                report.setdefault("isolatedRuns", []).append(
                    {
                        "case": identifier,
                        "report": str(child_report_path),
                        "result": child_report["result"],
                    }
                )
                observed = next(
                    (
                        case
                        for case in child_report["checks"]
                        if case["id"] == identifier
                    ),
                    None,
                )
                passed = (
                    child.returncode == 0 and observed and observed["status"] == "PASS"
                )
                record(
                    identifier,
                    "PASS" if passed else "FAIL",
                    (
                        observed["detail"]
                        if observed
                        else "Isolated case did not complete"
                    )
                    + "; isolated report: "
                    + str(child_report_path),
                )
            if args.only and all(
                request == "VM-03.cancel"
                or request == "VM-16"
                or request.startswith("VM-16.")
                for request in args.only.split(",")
            ):
                for request in unmatched_requests(args.only, report["checks"]):
                    record(
                        "REQUEST." + request,
                        "BLOCKED",
                        "Requested isolated subcase is unknown",
                    )
                return (
                    0
                    if report["checks"]
                    and all(case["status"] == "PASS" for case in report["checks"])
                    else 1
                )
        vm.start(show=args.show)
        vm.wait_ssh()
        vm.ssh("mkdir -p tyco-vm")
        for name in (
            "guest.py",
            "receiver.py",
            "native-ui.py",
            "native-control.py",
            "observer.py",
            "observer.js",
            "terminal.py",
            "browser.py",
            "desktop-session.py",
            "secret-read.py",
            "llm-stub.py",
        ):
            vm.ssh(f"test ! -e tyco-vm/{name} || chmod u+w tyco-vm/{name}")
            vm.copy_to(scripts / name, "tyco-vm/")
            if vm.ssh(f"sha256sum tyco-vm/{name}").split()[0] != runner_hashes[name]:
                raise StepFailed(
                    "Guest fixture transfer does not match its frozen source: " + name
                )
        if (
            args.suite == "native"
            and args.isolated_case
            and args.isolated_case.startswith("VM-16.")
        ):
            graphics_content = "export QT_QUICK_BACKEND=software\nexport LIBGL_ALWAYS_SOFTWARE=1\nexport QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1\n"
            graphics_fixture = (
                "from pathlib import Path; d=Path.home()/'.config/plasma-workspace/env'; d.mkdir(parents=True,exist_ok=True); (d/'tyco-vm.sh').write_text("
                + repr(graphics_content)
                + ")"
            )
            vm.ssh("python3 -c " + shlex.quote(graphics_fixture))
            fixture_content = "[Autologin]\nUser=tester\nSession=plasma\nRelogin=true\n"
            fixture = (
                "from pathlib import Path; d=Path('/etc/plasmalogin.conf.d') if Path('/usr/lib/systemd/system/plasmalogin.service').exists() else Path('/etc/sddm.conf.d'); d.mkdir(exist_ok=True); (d/'zz-tyco-vm-autologin.conf').write_text("
                + repr(fixture_content)
                + ")"
            )
            vm.ssh("sudo python3 -c " + shlex.quote(fixture))
            previous_boot = vm.ssh("cat /proc/sys/kernel/random/boot_id").strip()
            vm.ssh(
                "sudo systemd-run --quiet --on-active=1 --timer-property=AccuracySec=100ms systemctl reboot"
            )

            def bootstrap_rebooted():
                try:
                    return (
                        vm.ssh("cat /proc/sys/kernel/random/boot_id", timeout=5).strip()
                        != previous_boot
                    )
                except (StepFailed, subprocess.TimeoutExpired):
                    return False

            wait_for(
                "fixture bootstrap reboot", bootstrap_rebooted, timeout=180, interval=2
            )
        report["session"] = wait_for(
            "unlocked KDE Wayland session", session_ready, timeout=120, interval=2
        )
        if args.suite != "prepare":
            report["preparedBase"] = json.loads(
                (vm.directory / "prepared.json").read_text()
            )
            report["preparedBase"]["sha256"] = sha256(vm.prepared)
        if args.suite == "prepare":
            if vm.prepared.exists():
                raise StepFailed(
                    "Prepared base already exists; use a new --vm directory to rebuild it"
                )
            if not args.driver.is_file():
                raise StepFailed(f"Missing tauri-driver: {args.driver}")
            vm.copy_to(args.driver, "tyco-vm/tauri-driver")
            for name in ("WebKitWebDriver", "webdriver-libs.tar.gz"):
                vm.copy_to(args.driver.parent / name, f"tyco-vm/{name}")
            report["environment"] = json.loads(guest("prepare", timeout=1500))
            record(
                "PREPARE",
                "PASS",
                "Dependencies installed; separate input daemon and native WebDriver prepared",
            )
            prepared = True
        else:
            (vm.run_dir / "offline.txt").write_text(guest("offline"))
            report["environment"] = json.loads(guest("inventory"))
            record(
                "ENVIRONMENT",
                "PASS",
                "Real unlocked KDE Wayland session; external egress blocked",
            )
            # Artifact names and guest paths stay fixed and shell-safe.
            application = (
                "Tyco.AppImage" if args.artifact.suffix == ".AppImage" else "tyco"
            )
            vm.copy_to(args.artifact, f"tyco-vm/{application}")
            copied_hash = vm.ssh(f"sha256sum tyco-vm/{application}").split()[0]
            if copied_hash != report["artifact"]["sha256"]:
                raise StepFailed(
                    "Application artifact changed while being copied to the guest"
                )
            vm.ssh(f"chmod 755 tyco-vm/{application}")
            if args.ctl:
                vm.copy_to(args.ctl, "tyco-vm/tyco-ctl")
                if (
                    vm.ssh("sha256sum tyco-vm/tyco-ctl").split()[0]
                    != report["cli"]["sha256"]
                ):
                    raise StepFailed(
                        "CLI artifact changed while being copied to the guest"
                    )
                vm.ssh("chmod 755 tyco-vm/tyco-ctl")
            if args.previous_artifact:
                vm.copy_to(args.previous_artifact, "tyco-vm/Previous.AppImage")
                if (
                    vm.ssh("sha256sum tyco-vm/Previous.AppImage").split()[0]
                    != report["previousArtifact"]["sha256"]
                ):
                    raise StepFailed("Previous artifact changed during guest transfer")
            if args.suite == "package":
                from package import run_package_checks

                run_package_checks(
                    vm=vm,
                    args=args,
                    guest=guest,
                    record=record,
                    report=report,
                    setup_observer=setup_observer,
                )
            else:
                setup_services()
                connect_driver()
                config = json.loads(
                    (ROOT / "packages/shared/src/user-config-defaults.json").read_text()
                )
                config["configVersion"] = json.loads(
                    (ROOT / "packages/shared/src/config-version.json").read_text()
                )
                config["language"]["ui"] = "en-US"
                config["isInDevelopment"] = True
                config["editor"]["submitKey"] = "Ctrl+Enter"
                config["hotkeys"] = dict.fromkeys(config["hotkeys"], "")
                config["hotkeys"]["quickInput"] = "Ctrl+Alt+I"
                config["hotkeys"]["selectionCorrection"] = "Ctrl+Alt+K"
                for page in config["launcherPages"]:
                    page["hotkey"] = ""
                config_path = vm.run_dir / "fixture-config.json"
                config_path.write_text(json.dumps(config))
                vm.ssh("mkdir -p .config/com.tyco.app")
                vm.copy_to(config_path, ".config/com.tyco.app/config.json")
                desktop = vm.run_dir / "com.tyco.app.desktop"
                desktop.write_text(
                    f"[Desktop Entry]\nType=Application\nName=TyCo\nExec=/home/{vm.user}/tyco-vm/{application}\nTerminal=false\n"
                )
                vm.ssh("mkdir -p .local/share/applications")
                vm.copy_to(desktop, ".local/share/applications/com.tyco.app.desktop")
                vm.ssh("update-desktop-database .local/share/applications")
                setup_observer()
                driver.start(f"/home/{vm.user}/tyco-vm/{application}")
                from scenarios import run_scenarios

                run_scenarios(
                    vm,
                    driver,
                    args,
                    guest,
                    record,
                    report,
                    recover_controls=recover_controls,
                    ensure_driver_transport=ensure_driver_transport,
                )
                if args.only:
                    for request in unmatched_requests(args.only, report["checks"]):
                        record(
                            f"REQUEST.{request}",
                            "BLOCKED",
                            "Requested subcase has no implemented check or declared acceptance gap",
                        )
    except (Exception, KeyboardInterrupt) as error:
        failed = True
        record(
            "RUNNER",
            "BLOCKED" if not driver or not driver.session else "FAIL",
            str(error),
        )
        (vm.run_dir / "exception.txt").write_text(traceback.format_exc())
    finally:
        if vm.qmp:
            try:
                vm.qmp.screenshot(vm.run_dir / "final.png")
            except Exception as error:
                record("SCREENSHOT", "BLOCKED", str(error))
        if vm.process and vm.process.poll() is None:
            try:
                vm.ssh(
                    "journalctl --user -b --no-pager > tyco-vm/journal.log; sudo journalctl -b --no-pager > tyco-vm/system.log",
                    timeout=30,
                )
                vm.ssh(
                    "for pid in $(pgrep -x tyco); do cat /proc/$pid/maps; done > tyco-vm/app-maps.txt"
                )
                vm.ssh(
                    "test ! -f .local/state/com.tyco.app/logs/tyco.log || cp .local/state/com.tyco.app/logs/tyco.log tyco-vm/app.log"
                )
                archive_script = "import pathlib,tarfile; root=pathlib.Path('tyco-vm'); archive=tarfile.open(root/'diagnostics.tar.gz','w:gz'); [archive.add(p,arcname=p.name) for p in root.iterdir() if p.is_file() and p.suffix in ('.log','.json','.jsonl','.txt','.nft','.ack')]; archive.close()"
                vm.ssh("python3 -c " + shlex.quote(archive_script), timeout=30)
                vm.copy_from(
                    "tyco-vm/diagnostics.tar.gz", vm.run_dir / "diagnostics.tar.gz"
                )
            except Exception as error:
                failed = True
                record("DIAGNOSTICS", "BLOCKED", str(error))
        failed = failed or any(check["status"] != "PASS" for check in report["checks"])
        if failed and args.hold_on_failure and vm.process and vm.process.poll() is None:
            print(
                f"Failed guest is running on SSH port {vm.port}. Press Enter to shut down.",
                flush=True,
            )
            try:
                input()
            except EOFError:
                print("Diagnostic input closed; shutting down guest.", flush=True)
        if driver:
            try:
                driver.stop()
            except Exception as error:
                failed = True
                record("TEARDOWN", "FAIL", str(error))
        if forward:
            forward.terminate()
            forward.wait(timeout=10)
        # Only a shut down overlay may become a reusable prepared base.
        try:
            clean_shutdown = vm.stop(keep=args.keep or failed or prepared)
            if prepared and not clean_shutdown:
                failed = True
                record(
                    "SHUTDOWN",
                    "FAIL",
                    "Preparation guest did not shut down cleanly; disk was not promoted",
                )
        except Exception as error:
            failed = True
            record("SHUTDOWN", "FAIL", str(error))
        if prepared and not failed:
            vm.overlay.rename(vm.prepared)
            vm.prepared.chmod(0o444)
            stat = vm.original_base.stat()
            manifest = {
                "base": str(vm.original_base),
                "baseSize": stat.st_size,
                "baseMtimeNs": stat.st_mtime_ns,
                "profileSha256": sha256(vm.profile),
                "guestSha256": report["runnerSha256"]["guest.py"],
                "preparedFrom": str(vm.run_dir),
            }
            (vm.directory / "prepared.json").write_text(
                json.dumps(manifest, indent=2) + "\n"
            )
        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        report["result"] = (
            "PASS"
            if not failed
            and all(check["status"] == "PASS" for check in report["checks"])
            else "FAIL"
        )
        (vm.run_dir / "report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n"
        )
        print(
            f"Result: {report['result']}; report: {vm.run_dir / 'report.json'}",
            flush=True,
        )
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
