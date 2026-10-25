"""Exercise real external command grants through the packaged CLI."""

import json
import shlex

from vmlib import StepFailed, wait_for


def run_command_grant_checks(*, vm, driver, guest, check, selected, args):
    if not selected("VM-13.command-grants"):
        return

    def scenario():
        if args.ctl is None:
            raise StepFailed("--ctl is required for command grant checks")
        before = driver.invoke("get_desktop_state")["settings"]["userConfig"]
        current = json.loads(json.dumps(before))
        identifier = "vm-command-grant-fixture"
        command = {
            "id": identifier,
            "name": "VM command grant fixture",
            "description": "Echo an isolated VM fixture",
            "phrases": [],
            "isVoiceEnabled": False,
            "toolId": "script",
            "toolConfig": {"command": "printf '%s' {{TEXT}}"},
            "isLlmArgumentParsingEnabled": False,
            "outputAction": "none",
            "isOutputLogged": False,
            "isAvailableExternally": False,
            "isEnabled": True,
        }
        current["commands"].append(command)

        def save():
            base = driver.invoke("get_desktop_state")["settings"]["userConfig"]
            driver.invoke(
                "save_user_config", {"baseConfig": base, "userConfig": current}
            )

        def cli(arguments):
            invocation = f"/home/{vm.user}/tyco-vm/tyco-ctl {arguments} --json"
            code = (
                "import json,subprocess; p=subprocess.run(['python3','tyco-vm/guest.py','env-run','--',"
                + ",".join(repr(value) for value in shlex.split(invocation))
                + "],capture_output=True,text=True); print(json.dumps({'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr}))"
            )
            return json.loads(vm.ssh("python3 -c " + shlex.quote(code)))

        def denied():
            result = cli(f"run {identifier} --text denied --wait --timeout 15")
            if (
                result["exit"] != 3
                or json.loads(result["stderr"])["code"] != "AccessDenied"
            ):
                raise StepFailed(f"Expected command access denial: {result}")

        try:
            save()
            denied()
            command["isAvailableExternally"] = True
            save()
            wait_for(
                "granted command in CLI catalog",
                lambda: identifier in cli("commands list")["stdout"],
            )
            fixture = "VM command input 'quoted'\nsecond line"
            result = cli(
                f"run {identifier} --text {shlex.quote(fixture)} --wait --timeout 15"
            )
            job = json.loads(result["stdout"])
            if (
                result["exit"] != 0
                or job.get("state") != "succeeded"
                or job.get("output") != fixture
            ):
                raise StepFailed(f"Command did not preserve input: {result}")
            command["isAvailableExternally"] = False
            save()
            wait_for(
                "revoked command absent from CLI catalog",
                lambda: identifier not in cli("commands list")["stdout"],
            )
            denied()
        finally:
            base = driver.invoke("get_desktop_state")["settings"]["userConfig"]
            driver.invoke(
                "save_user_config", {"baseConfig": base, "userConfig": before}
            )
        return "Real CLI denied an ungranted command, executed exact quoted/multiline input after grant, and denied it again after revocation"

    check("VM-13.command-grants", scenario)
