"""Provision and authenticate the real native KWallet test collection."""

import json
import hashlib
import shlex

from vmlib import StepFailed, wait_for


class WalletFixture:
    def __init__(self, guest):
        self.guest = guest

    def collection(self):
        return json.loads(
            self.guest(
                "env-run busctl --user --json=short call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service ReadAlias s default"
            )
        )["data"][0]

    def native_action(self, action, value):
        def perform():
            try:
                return self.guest(
                    "env-run "
                    + shlex.join(
                        [
                            "python3",
                            "tyco-vm/native-control.py",
                            action,
                            "ksecretd",
                            value,
                        ]
                    )
                )
            except StepFailed:
                return None

        return wait_for("native wallet " + action, perform, timeout=15)

    def enable_accessibility(self):
        for name in ("IsEnabled", "ScreenReaderEnabled"):
            self.guest(
                "env-run busctl --user set-property org.a11y.Bus /org/a11y/bus org.a11y.Status "
                + name
                + " b true"
            )

    def provision(self):
        if self.collection() != "/":
            return
        self.enable_accessibility()
        created = json.loads(
            self.guest(
                "env-run busctl --user --json=short call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service CreateCollection 'a{sv}s' 1 org.freedesktop.Secret.Collection.Label s 'Tyco VM Test Collection' default"
            )
        )["data"]
        if created[1] != "/":
            self.guest(
                "env-run busctl --user call org.freedesktop.secrets "
                + shlex.quote(created[1])
                + " org.freedesktop.Secret.Prompt Prompt s ''"
            )
            self.native_action("click", "Classic, blowfish encrypted file")
            self.native_action("click", "Finish")
            self.native_action("fill-passwords", "TycoVmWalletFixture83")
            self.native_action("click", "OK")
        wait_for(
            "real default KWallet collection",
            lambda: self.collection() != "/",
            timeout=15,
        )

    def unlock(self):
        collection = self.collection()
        if collection == "/":
            raise StepFailed("Native wallet collection was lost after desktop recovery")

        def locked():
            return (
                json.loads(
                    self.guest(
                        f"env-run busctl --user --json=short get-property org.freedesktop.secrets {collection} org.freedesktop.Secret.Collection Locked"
                    )
                )["data"]
                is True
            )

        if not locked():
            return
        self.enable_accessibility()
        result = json.loads(
            self.guest(
                f"env-run busctl --user --json=short call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service Unlock ao 1 {collection}"
            )
        )["data"]
        if result[1] != "/":
            self.guest(
                f"env-run busctl --user call org.freedesktop.secrets {result[1]} org.freedesktop.Secret.Prompt Prompt s ''"
            )
            self.native_action("fill-passwords", "TycoVmWalletFixture83")
            nodes = json.loads(
                self.guest(
                    "env-run python3 tyco-vm/native-ui.py --application ksecretd"
                )
            )
            buttons = [
                node["name"]
                for node in nodes
                if node.get("showing")
                and node.get("role") in ("button", "push button")
                and node.get("name") in ("OK", "Open", "Unlock")
            ]
            if len(buttons) != 1:
                raise StepFailed(f"Native wallet unlock action is ambiguous: {buttons}")
            self.native_action("click", buttons[0])
        wait_for("authenticated native wallet unlock", lambda: not locked(), timeout=15)

    def assert_available(self, driver, identifier, value):
        self.unlock()
        statuses = driver.invoke("get_secret_statuses")
        if not statuses.get(identifier, {}).get("available") or value in json.dumps(
            statuses
        ):
            raise StepFailed(
                "Recovered native secret is unavailable or raw data escaped through status"
            )
        evidence = json.loads(
            self.guest(
                "env-run python3 tyco-vm/secret-read.py " + shlex.quote(identifier)
            )
        )
        expected_hash = hashlib.sha256(value.encode()).hexdigest()
        if (
            evidence["lockedItems"]
            or len(evidence["items"]) != 1
            or evidence["items"][0]["sha256"] != expected_hash
        ):
            raise StepFailed(
                "Native wallet did not preserve exact lifecycle bytes: "
                + json.dumps(evidence)
            )
        return evidence["items"][0]
