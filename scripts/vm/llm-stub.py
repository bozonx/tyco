"""Deterministic OpenAI-compatible endpoint for native VM checks.

Listens on loopback where the default Ollama provider points. Each request is
appended to llm-stub-requests.jsonl; the answer is the content of
llm-stub-reply.json ({"text": str, "delaySeconds": float}), read per request.
Never reaches the network and never contains Tyco code.
"""

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WORK = Path(sys.argv[1])
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 11434
REQUESTS = WORK / "llm-stub-requests.jsonl"
REPLY = WORK / "llm-stub-reply.json"


def reply():
    try:
        data = json.loads(REPLY.read_text())
    except (OSError, ValueError):
        data = {}
    return str(data.get("text", "")), float(data.get("delaySeconds", 0))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            self.send_json({"object": "list", "data": [{"id": "qwen2.5:7b"}]})
        else:
            self.send_error(404)

    def send_json(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        request = json.loads(self.rfile.read(length) or b"{}")
        with REQUESTS.open("a") as log:
            log.write(json.dumps({"at": time.time(), "body": request}) + "\n")
        text, delay = reply()
        time.sleep(delay)
        model = request.get("model", "stub")
        created = int(time.time())
        try:
            if not request.get("stream"):
                self.send_json(
                    {
                        "id": "stub",
                        "object": "chat.completion",
                        "created": created,
                        "model": model,
                        "choices": [
                            {
                                "index": 0,
                                "message": {"role": "assistant", "content": text},
                                "finish_reason": "stop",
                            }
                        ],
                        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                    }
                )
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()

            def event(delta, finish=None):
                chunk = {
                    "id": "stub",
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
                }
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.flush()

            event({"role": "assistant", "content": ""})
            if text:
                event({"content": text})
            event({}, "stop")
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
