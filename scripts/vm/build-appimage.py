#!/usr/bin/env python3
"""Build an embedded AppImage against the Ubuntu 24.04 glibc baseline."""

import argparse
import hashlib
import json
import os
import subprocess
import tomllib

from vmlib import ROOT, run, sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    playwright = json.loads((ROOT / "apps/desktop-ui/package.json").read_text())[
        "devDependencies"
    ]["@playwright/test"]
    rust = tomllib.loads((ROOT / "rust-toolchain.toml").read_text())["toolchain"][
        "channel"
    ]
    parser.add_argument("--image", default=f"tyco-desktop-smoke:{playwright}-{rust}")
    parser.add_argument(
        "--release",
        action="store_true",
        help="Build the production profile without WebDriver automation",
    )
    parser.add_argument(
        "--no-bundle",
        action="store_true",
        help="Build an embedded executable without packaging",
    )
    args = parser.parse_args()
    profile = "release" if args.release else "debug"
    home = ROOT / "dev_files/vm/build-home"
    home.mkdir(parents=True, exist_ok=True)
    target = ROOT / "src-tauri/target/container"
    script = " && ".join(
        [
            'mkdir -p "$HOME/bin"',
            'corepack enable --install-directory "$HOME/bin"',
            'export PATH="$HOME/bin:$PATH"',
            "cargo build --manifest-path src-tauri/Cargo.toml --locked -p tyco-ctl"
            + (" --release" if args.release else ""),
            "pnpm tauri:build "
            + ("" if args.release else "--debug ")
            + ("--no-bundle" if args.no_bundle else "--bundles appimage"),
        ]
    )
    source_commit = run(["git", "rev-parse", "HEAD"], cwd=ROOT).strip()
    source_diff_before = hashlib.sha256(
        run(["git", "diff", "HEAD", "--binary"], cwd=ROOT).encode()
    ).hexdigest()
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--init",
            "--ipc=host",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "--env",
            f"HOME={home}",
            "--env",
            f"CARGO_HOME={home / '.cargo'}",
            "--env",
            f"CARGO_TARGET_DIR={target}",
            "--env",
            "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
            "--env",
            "APPIMAGE_EXTRACT_AND_RUN=1",
            "--env",
            "CARGO_BUILD_JOBS=2",
            "--volume",
            f"{ROOT}:{ROOT}",
            "--workdir",
            str(ROOT),
            args.image,
            "bash",
            "-c",
            script,
        ],
        check=True,
    )
    artifacts = (
        [target / profile / "tyco"]
        if args.no_bundle
        else (target / profile / "bundle/appimage").glob("*.AppImage")
    )
    for artifact in artifacts:
        metadata = {
            "profile": profile,
            "artifactSha256": sha256(artifact),
            "containerImage": args.image,
            "sourceCommit": source_commit,
            "sourceDiffBeforeSha256": source_diff_before,
            "containerImageId": run(
                ["docker", "image", "inspect", args.image, "--format", "{{.Id}}"],
                cwd=ROOT,
            ).strip(),
            "sourceDiffAfterSha256": hashlib.sha256(
                run(["git", "diff", "HEAD", "--binary"], cwd=ROOT).encode()
            ).hexdigest(),
        }
        artifact.with_name(artifact.name + ".build.json").write_text(
            json.dumps(metadata, indent=2) + "\n"
        )
    print(f"AppImage directory: {target / profile / 'bundle/appimage'}")
    print(f"CLI: {target / profile / 'tyco-ctl'}")


if __name__ == "__main__":
    main()
