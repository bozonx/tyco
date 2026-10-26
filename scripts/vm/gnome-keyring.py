"""Locked/unavailable GNOME Keyring checks using real prompts and bus policy."""

from importlib import import_module
import concurrent.futures
import json
import shlex

from vmlib import StepFailed, wait_for


def run_checks(*, vm, driver, args, guest, check, selected, report, provision):
    def require(condition, message):
        if not condition:
            raise StepFailed(message)

    def collection():
        return json.loads(
            guest(
                "env-run busctl --user --json=short call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service ReadAlias s default"
            )
        )["data"][0]

    def locked():
        path = collection()
        return (
            json.loads(
                guest(
                    f"env-run busctl --user --json=short get-property org.freedesktop.secrets {path} org.freedesktop.Secret.Collection Locked"
                )
            )["data"]
            is True
        )

    def native_password():
        nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
        matches = [
            node
            for node in nodes
            if node.get("showing") and node["role"] == "password text"
        ]
        return matches[0]["application"] if len(matches) == 1 else None

    def locked_keyring():
        provision()
        path = collection()
        guest(
            f"env-run busctl --user call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service Lock ao 1 {path}"
        )
        wait_for("locked GNOME Keyring", locked)
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        arguments = {
            "id": "vm-gnome-locked",
            "value": "DisposableGnomeLocked83",
            "origins": ["https://vm-fixture.invalid"],
        }
        future = executor.submit(driver.invoke_result, "set_secret", arguments)
        try:
            application = wait_for(
                "native GNOME unlock password prompt", native_password
            )
            nodes = json.loads(guest("env-run python3 tyco-vm/native-ui.py all"))
            report["gnomeLockedPrompt"] = nodes
            import_module("native-input").click_native(vm, guest, application, "Cancel")
            result = future.result(timeout=20)
            require(
                not result["ok"] and locked(),
                "Canceled unlock allowed storage or unlocked the keyring",
            )
            future = executor.submit(driver.invoke_result, "set_secret", arguments)
            application = wait_for(
                "native retry unlock password prompt", native_password
            )
            guest(
                "env-run python3 tyco-vm/native-control.py fill-passwords "
                + shlex.join([application, "TycoVmGnomeCollection83"])
            )
            import_module("native-input").click_native(vm, guest, application, "Unlock")
            require(
                future.result(timeout=20)["ok"],
                "Authenticated native unlock did not recover secret storage",
            )
            require(not locked(), "Native collection remained locked")
            driver.invoke("delete_secret", {"id": arguments["id"]})
            provision()
            return "Real GNOME collection lock, canceled unlock rejects storage, password-authenticated unlock restores exact native secret bytes"
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def unavailable():
        provision()
        path = collection()
        policy_path = "/etc/dbus-1/session.d/99-tyco-vm-secrets-denied.conf"
        policy = vm.run_dir / "gnome-secrets-denied.conf"
        policy.write_text(
            '<busconfig><policy context="default"><deny send_destination="org.freedesktop.secrets"/></policy></busconfig>'
        )
        vm.copy_to(policy, "tyco-vm/secrets-denied.conf")

        def reload():
            guest(
                "env-run busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig"
            )

        def restart():
            driver.stop()
            wait_for(
                "native process exit",
                lambda: not vm.ssh("pgrep -x tyco || true").strip(),
            )
            driver.start(
                f"/home/{vm.user}/tyco-vm/"
                + ("Tyco.AppImage" if args.artifact.suffix == ".AppImage" else "tyco")
            )

        try:
            vm.ssh("sudo install -m 644 tyco-vm/secrets-denied.conf " + policy_path)
            reload()
            denial = vm.ssh(
                f"python3 tyco-vm/guest.py env-run -- busctl --user get-property org.freedesktop.secrets {path} org.freedesktop.Secret.Collection Locked 2>tyco-vm/gnome-secret-denial.txt; test $? -ne 0 && cat tyco-vm/gnome-secret-denial.txt"
            )
            require("denied" in denial.lower(), "Native policy did not deny access")
            restart()
            result = driver.invoke_result(
                "set_secret",
                {
                    "id": "vm-gnome-unavailable",
                    "value": "DisposableGnomeUnavailable83",
                    "origins": ["https://vm-fixture.invalid"],
                },
            )
            require(
                not result["ok"] and bool(result.get("error")),
                "Unavailable Keyring reported successful storage",
            )
            require(
                not driver.invoke("get_secret_statuses")
                .get("vm-gnome-unavailable", {})
                .get("available"),
                "Failed secret advertised as usable",
            )
        finally:
            vm.ssh("sudo rm -f " + policy_path)
            reload()
            restart()
        provision()
        return "Real session-bus denial independently observed; restarted Tyco rejects storage; restoring service recovers native secret bytes"

    for identifier, action in (
        ("VM-12.locked-keyring", locked_keyring),
        ("VM-12.unavailable-keyring", unavailable),
    ):
        if selected(identifier):
            check(identifier, action)
