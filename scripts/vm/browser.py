"""Independent Firefox text receiver served on guest loopback only."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Lock

root = Path.home() / "tyco-vm"
HTML = b'<!doctype html><html><head><title>Tyco VM Browser Receiver</title><script src="/receiver.js" defer></script></head><body><label for="receiver">Native browser insertion receiver</label><textarea id="receiver" rows="20" cols="80" autofocus></textarea></body></html>'
SCRIPT = b"""const input = document.getElementById('receiver');
let changes = 0; let sequence = 0;
input.addEventListener('input', () => changes += 1);
function report() { fetch('/state', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sequence:sequence++,text:input.value, focused:document.hasFocus() && document.activeElement === input, changeCount:changes, selectionStart:input.selectionStart, selectionEnd:input.selectionEnd})}).catch(() => {}); }
input.focus(); setInterval(report, 100); report();"""


state_lock = Lock()
last_sequence = -1


class Receiver(BaseHTTPRequestHandler):
    def do_GET(self):
        data, mime = (
            (SCRIPT, "text/javascript")
            if self.path == "/receiver.js"
            else (HTML, "text/html")
        )
        self.send_response(200)
        self.send_header("content-type", mime)
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; connect-src 'self'",
        )
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["content-length"])))
        global last_sequence
        with state_lock:
            if data["sequence"] > last_sequence:
                temporary = root / "browser.tmp"
                temporary.write_text(json.dumps(data))
                temporary.replace(root / "browser.json")
                last_sequence = data["sequence"]
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_args):
        pass


ThreadingHTTPServer(("127.0.0.1", 8731), Receiver).serve_forever()
