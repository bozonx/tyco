"""Small W3C WebDriver client; only drives Tyco, never asserts foreign text."""

import http.client
import json
import urllib.error
import urllib.request

from vmlib import StepFailed, wait_for


class WebDriver:
    def __init__(self, port, read_disconnects=None):
        self.endpoint = f"http://127.0.0.1:{port}"
        self.session = None
        self.read_disconnects = [] if read_disconnects is None else read_disconnects

    def request(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            self.endpoint + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                result = json.load(response)
        except (http.client.RemoteDisconnected, ConnectionResetError) as error:
            self.read_disconnects.append(
                {
                    "sessionId": self.session,
                    "method": method,
                    "path": path,
                    "error": str(error),
                }
            )
            raise
        except urllib.error.HTTPError as error:
            raise StepFailed(
                f"WebDriver {path}: {error.read().decode()[-4000:]}"
            ) from error
        if (
            isinstance(result.get("value"), dict)
            and result["value"].get("error")
            and "message" in result["value"]
            and "ok" not in result["value"]
        ):
            raise StepFailed(f"WebDriver: {result['value']}")
        return result.get("value")

    def call(self, method, path, body=None):
        return self.request(method, f"/session/{self.session}" + path, body)

    def start(self, application):
        created = self.request(
            "POST",
            "/session",
            {
                "capabilities": {
                    "alwaysMatch": {
                        "tauri:options": {
                            "application": application,
                            "args": ["editor"],
                        }
                    }
                }
            },
        )
        self.session = created["sessionId"]
        # A new session can precede WebKit's first usable connection. Observe
        # window readiness before sending configuration; never replay startup.
        self.window("main", ".cm-editor")
        self.call("POST", "/timeouts", {"script": 20000, "implicit": 0})
        origin = self.execute("return location.origin")
        if origin not in (
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ):
            raise StepFailed(f"Expected embedded assets, got {origin}")

    def execute(self, script, args=None):
        return self.call(
            "POST", "/execute/sync", {"script": script, "args": args or []}
        )

    def invoke_result(self, command, arguments=None):
        return self.call(
            "POST",
            "/execute/async",
            {
                "script": "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(value => done({ok:true,value}), error => done({ok:false,error}));",
                "args": [command, arguments or {}],
            },
        )

    def invoke(self, command, arguments=None):
        result = self.invoke_result(command, arguments)
        if not result["ok"]:
            raise StepFailed(f"IPC {command}: {result.get('error')}")
        return result.get("value")

    def window(self, name, selector=None, exclude=()):
        def find():
            try:
                handles = self.call("GET", "/window/handles")
            except (http.client.RemoteDisconnected, ConnectionResetError) as error:
                # Only repeat observation, retaining the same app/session. Never
                # replay clicks, IPC commands, or application startup here.
                self.read_disconnects.append(
                    {
                        "sessionId": self.session,
                        "path": "/window/handles",
                        "error": str(error),
                    }
                )
                return None
            for handle in handles:
                if handle in exclude:
                    continue
                self.call("POST", "/window", {"handle": handle})
                if self.execute(
                    "return document.documentElement.dataset.window === arguments[0] && (!arguments[1] || Boolean(document.querySelector(arguments[1])))",
                    [name, selector],
                ):
                    return handle
            return None

        return wait_for(f"Tyco {name} window", find, timeout=30)

    def text(self, selector, text):
        element = self.call(
            "POST", "/element", {"using": "css selector", "value": selector}
        )
        identifier = element["element-6066-11e4-a52e-4f735466cecf"]
        self.call("POST", f"/element/{identifier}/value", {"text": text})

    def stop(self):
        if self.session:
            try:
                self.request("DELETE", f"/session/{self.session}")
            finally:
                self.session = None
