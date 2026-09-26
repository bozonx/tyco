import type { AudioChunk } from '@bozonx/ai-kit'
import { DESKTOP_COMMANDS } from '@tyco/shared'

import { createAsyncQueue } from '../net/async-queue'
import { errorMessage, isArrayBuffer, type NetIpc } from '../net/net-ipc'

export interface VoiceCapture {
  /** Rate of the PCM16 mono audio, in hertz */
  sampleRate: number
  /** Ends once the microphone is stopped and its last chunk delivered */
  audio: AsyncIterable<AudioChunk>
}

export interface VoiceCaptureControl {
  start: () => Promise<VoiceCapture>
  /** Resolves once the microphone is off; `audio` then drains and ends */
  stop: () => Promise<void>
}

type CaptureEvent = { type: 'end' } | { type: 'error'; message: string }

/** The microphone in Rust, streamed as it records; see `services/voice.rs`. */
export function createVoiceCaptureControl(ipc: NetIpc): VoiceCaptureControl {
  return {
    async start() {
      const queue = createAsyncQueue<AudioChunk>()
      const onMessage = (message: unknown) => {
        if (isArrayBuffer(message)) {
          queue.push({ data: new Uint8Array(message) })
          return
        }
        const event = message as CaptureEvent
        if (event.type === 'end') queue.end()
        else if (event.type === 'error') queue.fail(new Error(event.message))
      }

      try {
        const { sampleRate } = await ipc.invoke<{ sampleRate: number }>(
          DESKTOP_COMMANDS.START_VOICE_CAPTURE,
          { onAudio: ipc.createChannel(onMessage) }
        )
        return { sampleRate, audio: queue.values }
      } catch (error) {
        throw new Error(errorMessage(error), { cause: error })
      }
    },

    async stop() {
      try {
        await ipc.invoke(DESKTOP_COMMANDS.STOP_VOICE_CAPTURE)
      } catch (error) {
        throw new Error(errorMessage(error), { cause: error })
      }
    },
  }
}
