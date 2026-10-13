import type { AudioChunk } from '@bozonx/ai-kit'
import { DESKTOP_COMMANDS, type VoiceCaptureEvent } from '@tyco/shared'

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

/** The microphone in Rust, streamed as it records; see `services/voice.rs`. */
export function createVoiceCaptureControl(ipc: NetIpc): VoiceCaptureControl {
  // the microphone is shared by the windows: a stop names the capture it ends,
  // so a late one leaves a capture started since, here or in another window
  let sessionId: number | undefined

  return {
    async start() {
      let overflowed = false
      let captureSessionId: number | undefined
      const queue = createAsyncQueue<AudioChunk>({
        maxBytes: 4 * 1024 * 1024,
        sizeOf: (chunk) => chunk.data.byteLength,
        onOverflow: () => {
          overflowed = true
          if (captureSessionId !== undefined)
            void ipc
              .invoke(DESKTOP_COMMANDS.STOP_VOICE_CAPTURE, {
                sessionId: captureSessionId,
              })
              .catch(() => undefined)
        },
      })
      const onMessage = (message: unknown) => {
        if (isArrayBuffer(message)) {
          queue.push({ data: new Uint8Array(message) })
          return
        }
        const event = message as VoiceCaptureEvent
        if (event.type === 'end') queue.end()
        else if (event.type === 'error') queue.fail(new Error(event.message))
      }

      try {
        const started = await ipc.invoke(DESKTOP_COMMANDS.START_VOICE_CAPTURE, {
          onAudio: ipc.createChannel(onMessage),
        })
        captureSessionId = started.sessionId
        sessionId = captureSessionId
        if (overflowed)
          await ipc.invoke(DESKTOP_COMMANDS.STOP_VOICE_CAPTURE, { sessionId })
        const { sampleRate } = started
        return { sampleRate, audio: queue.values }
      } catch (error) {
        throw new Error(errorMessage(error), { cause: error })
      }
    },

    async stop() {
      try {
        // nothing started here: there is nothing of ours to stop
        if (sessionId === undefined) return
        await ipc.invoke(DESKTOP_COMMANDS.STOP_VOICE_CAPTURE, { sessionId })
      } catch (error) {
        throw new Error(errorMessage(error), { cause: error })
      }
    },
  }
}
