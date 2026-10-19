# The Linux job `desktop-smoke` of .github/workflows/ci.yml as an image, for
# `pnpm test:desktop:container`. Keep the packages and versions in step with
# that job.
ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG RUST_TOOLCHAIN
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev libgtk-layer-shell-dev libasound2-dev \
    webkit2gtk-driver xvfb openbox dbus-x11 \
  && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
# with the components of rust-toolchain.toml, which rustup would otherwise
# install at run time into a directory the user cannot write
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain "${RUST_TOOLCHAIN}" \
      --component clippy,rustfmt \
  && cargo install tauri-driver --version 2.0.5 --locked \
  && rm -rf "$CARGO_HOME/registry" "$CARGO_HOME/git" \
  && chmod -R a+rX "$RUSTUP_HOME" "$CARGO_HOME"
