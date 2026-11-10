import type { AudioInputDevice, VoiceCaptureEvent } from '@tyco/shared'

import { errorMessage, isArrayBuffer, type NetIpc } from '../net/net-ipc'
import type { ControlOption } from '../ui/control-option'

/** Lists input devices (microphones) available on this machine. */
export function listInputDevices(ipc: NetIpc): Promise<AudioInputDevice[]> {
  return ipc.invoke('list_input_devices')
}

export interface MicrophoneSelectOptions {
  devices: readonly AudioInputDevice[]
  selectedId: string | undefined
  systemDefaultLabel: string
  defaultTagLabel: string
  unavailableTagLabel: string
}

/**
 * Builds select options for the microphone dropdown: "System default" first,
 * then connected microphones, keeping a disconnected saved choice visible so
 * the setting is not silently lost.
 */
export function buildMicrophoneOptions(
  input: MicrophoneSelectOptions
): ControlOption<string>[] {
  const options: ControlOption<string>[] = [
    { id: '', name: input.systemDefaultLabel },
  ]
  for (const device of input.devices) {
    options.push({
      id: device.id,
      name: device.isDefault
        ? `${device.label} (${input.defaultTagLabel})`
        : device.label,
    })
  }
  const selected = input.selectedId?.trim()
  if (selected && !input.devices.some((device) => device.id === selected)) {
    options.push({
      id: selected,
      name: `${selected} (${input.unavailableTagLabel})`,
    })
  }
  return options
}

export interface MicrophoneTester {
  start: (microphoneId?: string) => Promise<void>
  stop: () => Promise<void>
}

export interface MicrophoneTesterDependencies {
  ipc: NetIpc
  onStopped: () => void
  onError: (message: string) => void
}

/**
 * Captures audio from the chosen microphone purely to drive the live
 * `VoiceAudioLevel` meter in Settings without contacting any STT provider.
 */
export function createMicrophoneTester(
  deps: MicrophoneTesterDependencies
): MicrophoneTester {
  let sessionId: number | undefined
  let generation = 0

  const stop = async () => {
    generation += 1
    const activeId = sessionId
    sessionId = undefined
    if (activeId === undefined) return
    await deps.ipc
      .invoke('stop_voice_capture', { sessionId: activeId })
      .catch(() => undefined)
  }

  return {
    async start(microphoneId) {
      await stop()
      const run = ++generation
      const trimmed = microphoneId?.trim()
      const started = await deps.ipc.invoke('start_voice_capture', {
        onAudio: deps.ipc.createChannel((message: unknown) => {
          if (run !== generation || isArrayBuffer(message)) return
          const event = message as VoiceCaptureEvent
          if (event.type === 'end' || event.type === 'superseded') {
            sessionId = undefined
            deps.onStopped()
          } else if (event.type === 'error') {
            sessionId = undefined
            deps.onError(event.message)
            deps.onStopped()
          }
        }),
        source: { kind: 'microphone' },
        ...(trimmed && { microphoneId: trimmed }),
      })
      if (run !== generation) {
        await deps.ipc
          .invoke('stop_voice_capture', { sessionId: started.sessionId })
          .catch(() => undefined)
        return
      }
      sessionId = started.sessionId
    },
    stop: async () => {
      try {
        await stop()
      } catch (error) {
        deps.onError(errorMessage(error))
      }
    },
  }
}
