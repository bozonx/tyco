"""Linux desktop guest preparation and probes. Runs only in a disposable VM."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

WORK = Path.home() / "tyco-vm"


def command(argv, check=True, timeout=60, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, **kwargs)
    if check and result.returncode:
        raise RuntimeError(f"{argv}: {result.stderr[-4000:]}")
    return result


def session_environment():
    os.environ["XDG_RUNTIME_DIR"] = f"/run/user/{os.getuid()}"
    os.environ["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path=/run/user/{os.getuid()}/bus"
    manager = command(["systemctl", "--user", "show-environment"]).stdout
    environment = dict(line.split("=", 1) for line in manager.splitlines() if "=" in line)
    for key in ("DISPLAY", "WAYLAND_DISPLAY", "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "XDG_SESSION_DESKTOP", "XAUTHORITY"):
        if key in environment:
            os.environ[key] = environment[key]
    expected = (WORK / "expected-desktop").read_text().strip() if (WORK / "expected-desktop").exists() else "KDE"
    if os.environ.get("XDG_SESSION_TYPE") != "wayland" or expected not in os.environ.get("XDG_CURRENT_DESKTOP", ""):
        raise RuntimeError(f"Expected {expected} Wayland, got {environment}")
    if not (Path(os.environ["XDG_RUNTIME_DIR"]) / os.environ.get("WAYLAND_DISPLAY", "missing")).is_socket():
        raise RuntimeError("The desktop Wayland socket is not ready")
    locked = command(["gdbus", "call", "--session", "--dest", "org.gnome.ScreenSaver" if expected == "GNOME" else "org.freedesktop.ScreenSaver", "--object-path", "/org/gnome/ScreenSaver" if expected == "GNOME" else "/ScreenSaver", "--method", "org.gnome.ScreenSaver.GetActive" if expected == "GNOME" else "org.freedesktop.ScreenSaver.GetActive"]).stdout
    if "false" not in locked:
        raise RuntimeError("The desktop session is locked")
    return {key: os.environ.get(key) for key in ("XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP", "WAYLAND_DISPLAY", "DISPLAY", "XDG_RUNTIME_DIR")}


def stop_lhc():
    units = command(["systemctl", "--user", "list-unit-files", "--no-legend"], check=False).stdout
    for line in units.splitlines():
        unit = line.split()[0]
        if "left-hand-control" in unit or unit.startswith("lhc-"):
            command(["systemctl", "--user", "mask", "--now", unit], check=False)
    for path in (Path.home() / ".config/autostart").glob("*.desktop"):
        if "left-hand-control" in path.read_text().lower():
            path.write_text("[Desktop Entry]\nType=Application\nHidden=true\n")
    command(["pkill", "-u", str(os.getuid()), "-f", "^(/[^ ]*/)?left-hand-control( |$)"], check=False)
    if command(["pgrep", "-u", str(os.getuid()), "-f", "^(/[^ ]*/)?left-hand-control( |$)"], check=False).returncode == 0:
        raise RuntimeError("LHC is still running")


def prepare():
    session_environment()
    stop_lhc()
    # Do not upgrade the base; add only packages needed by Tyco and automation.
    packages = ["python3-gobject", "gtk3", "webkit2gtk4.1", "webkit2gtk4.1-devel",
                "libayatana-appindicator-gtk3", "gtk-layer-shell", "alsa-lib", "libxdo",
                "wl-clipboard", "xclip", "xdotool", "ydotool", "nftables", "kate", "konsole",
                "xdg-desktop-portal-kde", "libsecret", "fuse-libs", "at-spi2-core"]
    if "GNOME" in os.environ["XDG_CURRENT_DESKTOP"]:
        packages = ["python3-gi", "gir1.2-gtk-3.0", "gir1.2-atspi-2.0", "libwebkit2gtk-4.1-0", "libayatana-appindicator3-1", "libgtk-layer-shell0", "libasound2t64", "libxdo3", "wl-clipboard", "xclip", "xdotool", "ydotool", "nftables", "gnome-text-editor", "libsecret-tools", "libfuse2t64", "at-spi2-core", "desktop-file-utils", "pulseaudio-utils", "pipewire-bin"]
        command(["sudo", "apt-get", "update"], timeout=600)
        result = command(["sudo", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", *packages], timeout=1200)
        command(["gsettings", "set", "org.gnome.desktop.session", "idle-delay", "0"])
        command(["gsettings", "set", "org.gnome.desktop.screensaver", "lock-enabled", "false"])
        extensions = command(["gnome-extensions", "list", "--enabled"]).stdout.splitlines()
        for extension in extensions:
            if "lhc" in extension.lower() or "left-hand" in extension.lower():
                command(["gnome-extensions", "disable", extension])
    else:
        result = command(["sudo", "dnf", "install", "-y", *packages], timeout=1200)
    (WORK / "packages-install.log").write_text(result.stdout + result.stderr)
    # The daemon alone owns uinput; Tyco receives just its private socket.
    command(["sudo", "modprobe", "uinput"])
    unit = "\n".join([
        "[Unit]", "Description=Tyco VM input fixture", "After=systemd-user-sessions.service",
        "[Service]", f"ExecStart=/usr/bin/ydotoold --socket-path=/run/user/{os.getuid()}/.ydotool_socket --socket-own={os.getuid()}:{os.getgid()} --socket-perm=0600",
        "Restart=on-failure", "[Install]", "WantedBy=multi-user.target", "",
    ])
    unit_path = WORK / "tyco-vm-ydotool.service"
    unit_path.write_text(unit)
    command(["sudo", "install", "-m", "644", str(unit_path), "/etc/systemd/system/tyco-vm-ydotool.service"])
    command(["sudo", "systemctl", "daemon-reload"])
    command(["sudo", "systemctl", "enable", "--now", "tyco-vm-ydotool.service"])
    # Keep screen-lock and idle power from swallowing test input. Dedicated
    # lifecycle cases explicitly change these settings when they are exercised.
    for filename, content in {
        "kscreenlockerrc": "[Daemon]\nAutolock=false\nLockOnResume=false\n",
        "powerdevilrc": "[AC][SuspendAndShutdown]\nAutoSuspendAction=0\n[AC][Display]\nTurnOffDisplayWhenIdle=false\n",
    }.items():
        (Path.home() / ".config" / filename).write_text(content)
    driver = WORK / "tauri-driver"
    driver.chmod(0o755)
    bundled = WORK / "WebKitWebDriver"
    bundled.chmod(0o755)
    libraries = WORK / "webdriver-libs"
    libraries.mkdir(exist_ok=True)
    command(["tar", "-xzf", str(WORK / "webdriver-libs.tar.gz"), "-C", str(libraries)])
    wrapper = WORK / "native-driver"
    wrapper.write_text(f'#!/bin/sh\nexport LD_LIBRARY_PATH="{libraries}${{LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}}"\nexec "{bundled}" "$@"\n')
    wrapper.chmod(0o755)
    webdriver = shutil.which("WebKitWebDriver")
    if not webdriver:
        candidates = list(Path("/usr").glob("libexec/**/WebKitWebDriver"))
        webdriver = str(candidates[0]) if candidates else str(wrapper)
    command([webdriver, "--help"])
    command([str(driver), "--help"])
    (WORK / "webdriver-path").write_text(webdriver)
    print(json.dumps(inventory()))


def inventory():
    environment = session_environment()
    packages = command((["rpm", "-q", "fedora-release", "plasma-workspace", "kwin", "webkit2gtk4.1", "xdg-desktop-portal", "xdg-desktop-portal-kde", "kate", "konsole", "ydotool"] if shutil.which("rpm") else ["true"]), check=False).stdout
    if "GNOME" in os.environ["XDG_CURRENT_DESKTOP"]:
        packages = command(["dpkg-query", "-W", "gnome-shell", "mutter", "libwebkit2gtk-4.1-0", "xdg-desktop-portal", "xdg-desktop-portal-gnome", "gnome-text-editor", "ydotool"], check=False).stdout
    services = command(["busctl", "--user", "list", "--no-pager"], check=False).stdout
    return {"session": environment, "os": Path("/etc/os-release").read_text(),
            "kernel": os.uname().release, "packages": packages,
            "services": services, "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "selinux": command(["getenforce"], check=False).stdout.strip() if shutil.which("getenforce") else "unavailable",
            "uinput": Path("/dev/uinput").exists(),
            "ydotoolSocket": (Path(os.environ["XDG_RUNTIME_DIR"]) / ".ydotool_socket").is_socket()}


def offline():
    session_environment()
    # Keep SSH replies to SLIRP's gateway and loopback fixtures. Every other
    # destination is rejected, including established connections and DNS.
    rules = WORK / "offline.nft"
    rules.write_text("""table inet tyco_vm {
 chain output {
  type filter hook output priority -100; policy drop;
  oifname "lo" accept
  ip daddr 10.0.2.2 tcp sport 22 accept
  counter reject
 }
}
""")
    command(["sudo", "nft", "delete", "table", "inet", "tyco_vm"], check=False)
    command(["sudo", "nft", "-f", str(rules)])
    result = command(["python3", "-c", "import socket; socket.create_connection(('1.1.1.1',443),3)"], check=False, timeout=10)
    if result.returncode == 0:
        raise RuntimeError("Guest still has external Internet access")
    print(command(["sudo", "nft", "list", "table", "inet", "tyco_vm"]).stdout)


def launch(argv, filename, environment=None):
    log = (WORK / filename).open("a")
    process = subprocess.Popen(argv, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    log.close()
    return process.pid


def start_driver():
    session_environment()
    environment = dict(os.environ, GDK_BACKEND="wayland", YDOTOOL_SOCKET=f"/run/user/{os.getuid()}/.ydotool_socket")
    # Preserve the real runtime dir and session bus; never create an X11 or
    # private D-Bus session for a native Wayland test.
    argv = [str(WORK / "tauri-driver"), "--native-driver", (WORK / "webdriver-path").read_text().strip()]
    print(launch(argv, "driver.log", environment))


def start_receiver(backend):
    session_environment()
    environment = dict(os.environ, GDK_BACKEND=backend)
    print(launch(["python3", str(WORK / "receiver.py"), str(WORK), backend], f"receiver-{backend}.log", environment))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("session", "prepare", "inventory", "offline", "driver", "receiver", "env-run"))
    parser.add_argument("arguments", nargs="*")
    args = parser.parse_args()
    WORK.mkdir(exist_ok=True)
    if args.action == "prepare":
        prepare()
    elif args.action == "session":
        print(json.dumps(session_environment()))
    elif args.action == "inventory":
        print(json.dumps(inventory()))
    elif args.action == "offline":
        offline()
    elif args.action == "driver":
        start_driver()
    elif args.action == "receiver":
        start_receiver(args.arguments[0])
    else:
        session_environment()
        result = subprocess.run(args.arguments)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
