#!/usr/bin/env python3
"""Extract pinned VM automation tools from a local Tyco desktop-test image."""

import argparse
import json
from pathlib import Path
import subprocess

from vmlib import ROOT, sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="tyco-desktop-smoke:1.64.0-1.98.1")
    parser.add_argument("--output", type=Path, default=ROOT / "dev_files/vm/tools")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    image = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", args.image],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    sources = {
        "tauri-driver": ["cat", "/usr/local/cargo/bin/tauri-driver"],
        "WebKitWebDriver": ["cat", "/usr/bin/WebKitWebDriver"],
        "webdriver-libs.tar.gz": [
            "tar",
            "-C",
            "/usr/lib/x86_64-linux-gnu",
            "-czh",
            "libicudata.so.74",
            "libicui18n.so.74",
            "libicuuc.so.74",
        ],
    }
    manifest = {"image": args.image, "imageId": image, "files": {}}
    for name, command in sources.items():
        path = args.output / name
        temporary = path.with_suffix(".partial")
        try:
            with temporary.open("wb") as stream:
                subprocess.run(
                    [
                        "docker",
                        "run",
                        "--rm",
                        "--network",
                        "none",
                        "--entrypoint",
                        command[0],
                        image,
                        *command[1:],
                    ],
                    stdout=stream,
                    check=True,
                )
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        manifest["files"][name] = sha256(path)
    (args.output / "tools.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Prepared tools: {args.output}")


if __name__ == "__main__":
    main()
