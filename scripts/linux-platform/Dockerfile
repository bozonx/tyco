FROM rust:1-trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev \
    librsvg2-dev libgtk-layer-shell-dev libasound2-dev \
    xvfb openbox xdotool xclip x11-utils dbus-x11 \
    kwin-wayland xwayland sway seatd udev wl-clipboard cmake scdoc \
    python3-gi gir1.2-gtk-3.0 libgl1-mesa-dri libegl-mesa0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --groups video,input tester
# Debian Trixie does not ship ydotool; build the upstream 1.x protocol used by Tyco.
RUN git clone --depth 1 --branch v1.0.4 https://github.com/ReimuNotMoe/ydotool.git /tmp/ydotool \
    && cmake -S /tmp/ydotool -B /tmp/ydotool/build -DCMAKE_INSTALL_PREFIX=/usr \
    && cmake --build /tmp/ydotool/build --parallel 2 \
    && cmake --install /tmp/ydotool/build \
    && rm -rf /tmp/ydotool
# Virtual KWin needs no realtime scheduling; its packaged file capability
# would prevent execution under Docker's default capability bounding set.
RUN setcap -r /usr/bin/kwin_wayland \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
WORKDIR /workspace
COPY . .
ENV CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=2 LANG=C.UTF-8
RUN --mount=type=cache,target=/workspace/src-tauri/target \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/rustup \
    cargo test --manifest-path src-tauri/Cargo.toml --locked --lib --no-run \
      --message-format=json > /tmp/build-artifacts.jsonl \
    && python3 -c 'import json, shutil; artifacts = [json.loads(line) for line in open("/tmp/build-artifacts.jsonl")]; executable = next(a["executable"] for a in artifacts if a.get("reason") == "compiler-artifact" and a.get("executable") and a["target"]["name"] == "tyco_lib"); shutil.copy2(executable, "/usr/local/bin/tyco-platform-tests")'
ENTRYPOINT ["bash", "/workspace/scripts/linux-platform/entrypoint.sh"]
