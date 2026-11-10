import type { AudioChunk } from '@bozonx/ai-kit'
import { type CaptureSource, type VoiceCaptureEvent } from '@tyco/shared'

import { createAsyncQueue } from '../net/async-queue'
import { errorMessage, isArrayBuffer, type NetIpc } from '../net/net-ipc'
import { DictationError } from './dictation-error'

/** What a playback source reports while it records */
export interface CaptureSourceHandlers {
  /** Its application plays nothing yet, or has started to */
  onWaiting?: (isWaiting: boolean) => void
  /** Its application quit: the capture went on with `source` */
  onSourceLost?: (source: CaptureSource) => void
}

interface VoiceCapture {
  /** Rate of the PCM16 mono audio, in hertz */
  sampleRate: number
  /** Ends once the microphone is stopped and its last chunk delivered */
  audio: AsyncIterable<AudioChunk>
  /** Whether `audio` ended because a newer capture took the microphone */
  isSuperseded: () => boolean
}

export interface VoiceCaptureControl {
  /** Records `source`, the microphone by default */
  start: (
    source?: CaptureSource,
    handlers?: CaptureSourceHandlers,
    microphoneId?: string
  ) => Promise<VoiceCapture>
  /** Records another playback source in the running capture */
  switchSource: (source: CaptureSource) => Promise<void>
  /** Resolves once the microphone is off; `audio` then drains and ends */
  stop: () => Promise<void>
}

/** The microphone in Rust, streamed as it records; see `services/voice.rs`. */
export function createVoiceCaptureControl(ipc: NetIpc): VoiceCaptureControl {
  // the microphone is shared by the windows: a stop names the capture it ends,
  // so a late one leaves a capture started since, here or in another window
  let sessionId: number | undefined

  return {
    async start(source, handlers = {}, microphoneId) {
      let overflowed = false
      let superseded = false
      let captureSessionId: number | undefined
      const queue = createAsyncQueue<AudioChunk>({
        maxBytes: 4 * 1024 * 1024,
        sizeOf: (chunk) => chunk.data.byteLength,
        onOverflow: () => {
          overflowed = true
          if (captureSessionId !== undefined)
            void ipc
              .invoke('stop_voice_capture', { sessionId: captureSessionId })
              .catch(() => undefined)
        },
      })
      const onMessage = (message: unknown) => {
        if (isArrayBuffer(message)) {
          queue.push({ data: new Uint8Array(message) })
          return
        }
        const event = message as VoiceCaptureEvent
        if (event.type === 'sourceStatus') handlers.onWaiting?.(event.isWaiting)
        else if (event.type === 'sourceLost')
          handlers.onSourceLost?.(event.source)
        else if (event.type === 'end') queue.end()
        else if (event.type === 'superseded') {
          // the audio before it is complete: it ends as usual
          superseded = true
          queue.end()
        } else if (event.type === 'error')
          queue.fail(
            new DictationError('microphoneLost', event.message, event.message)
          )
      }

      try {
        const trimmedMic = microphoneId?.trim()
        const started = await ipc.invoke('start_voice_capture', {
          onAudio: ipc.createChannel(onMessage),
          ...(source && { source }),
          ...(trimmedMic && { microphoneId: trimmedMic }),
        })
        captureSessionId = started.sessionId
        sessionId = captureSessionId
        if (overflowed) await ipc.invoke('stop_voice_capture', { sessionId })
        const { sampleRate } = started
        return {
          sampleRate,
          audio: (async function* () {
            try {
              yield* queue.values
            } catch (error) {
              throw overflowed
                ? new DictationError(
                    'overflow',
                    'The speech service fell behind the recording'
                  )
                : error
            }
          })(),
          isSuperseded: () => superseded,
        }
      } catch (error) {
        throw new Error(errorMessage(error), { cause: error })
      }
    },

    async switchSource(source) {
      if (sessionId === undefined)
        throw new Error('No capture is running to switch')
      try {
        await ipc.invoke('switch_capture_source', { sessionId, source })
      } catch (error) {
        throw new Error(errorMessage(error), { cause: error })
      }
    },

    async stop() {
      try {
        // nothing started here: there is nothing of ours to stop
        if (sessionId === undefined) return
        await ipc.invoke('stop_voice_capture', { sessionId })
      } catch (error) {
        throw new Error(errorMessage(error), { cause: error })
      }
    },
  }
}
