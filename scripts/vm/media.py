"""Capture real PCM through guest PipeWire/PulseAudio and Tyco's CPAL service."""

import json
import re
import shlex
import sys

from vmlib import StepFailed, wait_for


def require(condition, message):
    if not condition:
        raise StepFailed(message)


def run_media_checks(*, vm, driver, guest, check, selected, report):
    if not any(
        selected(identifier)
        for identifier in (
            "VM-15.capture-stop",
            "VM-15.audio-unavailable",
            "VM-15.device-removal",
        )
    ):
        return

    def capture(remove_device=False):
        prefix = f"/home/{vm.user}/tyco-vm"
        # This is a real guest audio source. Only its input signal is a fixture;
        # CPAL device opening, PCM capture, IPC delivery and teardown are native.
        before = guest("env-run pactl get-default-source").strip()
        metadata = guest("env-run pw-metadata -n default")
        configured = re.search(
            r"key:'default.configured.audio.source' value:'([^']*)' type:'([^']*)'",
            metadata,
        )
        report["audioOriginalDefault"] = {
            "resolved": before,
            "configured": configured.group(1) if configured else None,
        }
        sink = guest(
            "env-run pactl load-module module-null-sink sink_name=tyco_vm_audio"
        ).strip()
        source = None
        session_id = None
        try:
            source = guest(
                "env-run pactl load-module module-remap-source master=tyco_vm_audio.monitor source_name=tyco_vm_microphone"
            ).strip()
            guest("env-run pactl set-default-source tyco_vm_microphone")
            wave_script = (
                "import math,struct,wave; p="
                + repr(prefix + "/tone.wav")
                + "; w=wave.open(p,'wb'); w.setparams((1,2,48000,0,'NONE','not compressed')); w.writeframes(b''.join(struct.pack('<h',int(12000*math.sin(2*math.pi*440*n/48000))) for n in range(48000*5))); w.close()"
            )
            guest("env-run python3 -c " + shlex.quote(wave_script))
            result = driver.call(
                "POST",
                "/execute/async",
                {
                    "script": """
const done = arguments[arguments.length - 1];
const ipc = window.__TAURI_INTERNALS__;
window.vmAudio = {chunks:0, bytes:0, nonzero:0, ended:false, error:null};
const callback = ipc.transformCallback(({message}) => {
  const state = window.vmAudio;
  if (message instanceof ArrayBuffer) {
    state.chunks += 1; state.bytes += message.byteLength;
    const view = new DataView(message);
    for (let i=0; i+1<view.byteLength; i+=2) if (view.getInt16(i,true) !== 0) state.nonzero += 1;
  } else if (message?.type === 'end') state.ended = true;
  else if (message?.type === 'error') state.error = message.message;
});
ipc.invoke('start_voice_capture', {onAudio:'__CHANNEL__:'+callback})
  .then(info => done({ok:true,info}), error => done({ok:false,error}));
""",
                    "args": [],
                },
            )
            if not result["ok"]:
                raise StepFailed(f"Native capture failed: {result['error']}")
            session_id = result["info"]["sessionId"]
            guest(
                "env-run "
                + shlex.join(
                    [
                        "systemd-run",
                        "--user",
                        "--quiet",
                        "--collect",
                        f"--unit=tyco-vm-tone-{session_id}",
                        "paplay",
                        "--device=tyco_vm_audio",
                        prefix + "/tone.wav",
                    ]
                )
            )
            wait_for(
                "non-silent PCM from guest microphone",
                lambda: driver.execute(
                    "return window.vmAudio.nonzero > 3200 && window.vmAudio.chunks > 1"
                ),
                timeout=15,
            )
            initial_outputs = json.loads(
                guest("env-run pactl --format=json list source-outputs")
            )
            require(
                bool(initial_outputs), "No native audio recording client is registered"
            )
            if remove_device:
                sources = json.loads(guest("env-run pactl --format=json list sources"))
                removed_index = next(
                    item["index"]
                    for item in sources
                    if item["name"] == "tyco_vm_microphone"
                )
                bytes_before = driver.execute("return window.vmAudio.bytes")
                guest("env-run pactl unload-module " + source)
                source = None
                wait_for(
                    "actual virtual source removal",
                    lambda: all(
                        item["name"] != "tyco_vm_microphone"
                        for item in json.loads(
                            guest("env-run pactl --format=json list sources")
                        )
                    ),
                    timeout=10,
                )

                def reacted():
                    after = driver.execute("return window.vmAudio")
                    routed = json.loads(
                        guest("env-run pactl --format=json list source-outputs")
                    )
                    available_indexes = {
                        item["index"]
                        for item in json.loads(
                            guest("env-run pactl --format=json list sources")
                        )
                    }
                    report["audioRemoval"] = {
                        "removedIndex": removed_index,
                        "captureAfterRemoval": after,
                        "sourceOutputsAfterRemoval": routed,
                        "availableSourceIndexes": sorted(available_indexes),
                    }
                    valid_route = bool(routed) and all(
                        item["source"] in available_indexes
                        and item["source"] != removed_index
                        and not item["corked"]
                        for item in routed
                    )
                    return (
                        after["ended"]
                        or after["error"]
                        or (valid_route and after["bytes"] > bytes_before + 3200)
                    )

                wait_for(
                    "removed microphone error/end or live reroute to an existing source",
                    reacted,
                    timeout=15,
                )
            outputs = json.loads(
                guest("env-run pactl --format=json list source-outputs")
            )
            require(
                bool(outputs)
                or (
                    remove_device
                    and driver.execute(
                        "return window.vmAudio.ended || Boolean(window.vmAudio.error)"
                    )
                ),
                "Native capture disappeared without an end/error event",
            )
            stopped = driver.invoke_result(
                "stop_voice_capture", {"sessionId": session_id}
            )
            require(
                stopped["ok"]
                or (remove_device and driver.execute("return window.vmAudio.ended")),
                "Native capture did not stop",
            )
            wait_for(
                "native capture end event",
                lambda: driver.execute(
                    "return window.vmAudio.ended || (arguments[0] && Boolean(window.vmAudio.error))",
                    [remove_device],
                ),
                timeout=5,
            )
            captured_indexes = {item["index"] for item in initial_outputs + outputs}
            wait_for(
                "native recording clients released after stop",
                lambda: all(
                    item["index"] not in captured_indexes
                    for item in json.loads(
                        guest("env-run pactl --format=json list source-outputs")
                    )
                ),
                timeout=10,
            )
            result = driver.execute("return window.vmAudio")
            require(
                remove_device or result["error"] is None,
                f"Audio stream error: {result['error']}",
            )
            report["audioCapture"] = {"info": result, "sourceOutputs": outputs}
            (vm.run_dir / "audio-capture.json").write_text(
                json.dumps(report["audioCapture"], indent=2)
            )
            if remove_device:
                return "Actual virtual microphone removed during nonzero PCM capture; stream ended/reported error or followed a verified native reroute; stop released capture after the terminal error/end"
            return f"Native CPAL capture delivered {result['bytes']} PCM bytes including {result['nonzero']} nonzero samples; stop emitted end"
        finally:
            had_failure = sys.exc_info()[0] is not None
            cleanup_errors = []
            if session_id is not None:
                try:
                    driver.invoke_result(
                        "stop_voice_capture", {"sessionId": session_id}
                    )
                except Exception as error:
                    cleanup_errors.append(str(error))
            if session_id is not None:
                try:
                    unit = f"tyco-vm-tone-{session_id}.service"
                    command = f"if systemctl --user is-active --quiet {unit}; then systemctl --user stop {unit}; fi"
                    guest("env-run sh -c " + shlex.quote(command))
                    report["audioAfterCleanupStop"] = driver.execute(
                        "return window.vmAudio"
                    )
                    report["audioOutputsAfterCleanupStop"] = json.loads(
                        guest("env-run pactl --format=json list source-outputs")
                    )
                except Exception as error:
                    cleanup_errors.append(str(error))
            for module in (source, sink):
                if module is not None:
                    try:
                        guest("env-run pactl unload-module " + module)
                    except Exception as error:
                        cleanup_errors.append(str(error))
            try:
                # The automatic dummy monitor disappears while a real fixture
                # sink exists. Restore the configured policy, not that transient
                # resolved node name, which PipeWire may recreate asynchronously.
                key = "default.configured.audio.source"
                if configured:
                    guest(
                        "env-run pw-metadata -n default 0 "
                        + shlex.join([key, configured.group(1), configured.group(2)])
                    )
                else:
                    guest("env-run pw-metadata -n default --delete 0 " + key)
                restored = guest("env-run pw-metadata -n default")
                if configured:
                    require(
                        configured.group(0) in restored,
                        "Original configured audio source policy was not restored",
                    )
                else:
                    require(
                        "key:'" + key + "'" not in restored,
                        "Fixture audio source policy survived cleanup",
                    )
                report["audioRestoredMetadata"] = restored
            except Exception as error:
                cleanup_errors.append(str(error))
            if cleanup_errors:
                report.setdefault("audioCleanupErrors", []).extend(cleanup_errors)
                if not had_failure:
                    raise StepFailed(
                        "Audio fixture cleanup failed: " + "; ".join(cleanup_errors)
                    )

    def unavailable():
        units = "pipewire-pulse.socket pipewire-pulse.service pipewire.socket pipewire.service wireplumber.service"
        guest("env-run systemctl --user stop " + units)
        try:
            result = driver.call(
                "POST",
                "/execute/async",
                {
                    "script": "const done=arguments[arguments.length-1]; const ipc=window.__TAURI_INTERNALS__; const callback=ipc.transformCallback(()=>{}); ipc.invoke('start_voice_capture',{onAudio:'__CHANNEL__:'+callback}).then(info=>done({ok:true,info}),error=>done({ok:false,error}));",
                    "args": [],
                },
            )
            if result["ok"]:
                driver.invoke_result(
                    "stop_voice_capture", {"sessionId": result["info"]["sessionId"]}
                )
            require(
                not result["ok"] and bool(result.get("error")),
                "Unavailable guest audio was reported as successful capture",
            )
            report["audioUnavailableError"] = result["error"]
        finally:
            guest(
                "env-run systemctl --user start pipewire.socket pipewire.service pipewire-pulse.socket pipewire-pulse.service wireplumber.service"
            )
        wait_for(
            "restored native audio server",
            lambda: bool(guest("env-run pactl info")),
            timeout=15,
        )
        recovered = capture()
        return (
            "Actual PipeWire services and activation sockets stopped; CPAL returned an explicit error; restored server delivered real PCM: "
            + recovered
        )

    if selected("VM-15.capture-stop"):
        check("VM-15.capture-stop", capture)
    if selected("VM-15.audio-unavailable"):
        check("VM-15.audio-unavailable", unavailable)
    if selected("VM-15.device-removal"):
        check("VM-15.device-removal", lambda: capture(remove_device=True))
