import type { SttModel } from '@tyco/shared'

import {
  applyTranscriptPart,
  createLiveTranscriptState,
  type LiveTranscriptState,
  liveTranscriptText,
} from './live-transcript'
import type { SttClient } from './stt-client'
import type { VoiceCaptureControl } from './voice-capture'

/** How long the provider may take for its last words once the audio ends */
const FINISH_TIMEOUT_MS = 10_000

export interface LiveDictationDeps {
  capture: VoiceCaptureControl
  stt: SttClient
  finishTimeoutMs?: number
}

export interface LiveDictationStart {
  model: SttModel
  language?: string
  hasApiKey: boolean
  /** Every change of the text shown while dictating */
  onText: (state: LiveTranscriptState) => void
  /**
   * The session broke before it was finished: the microphone or the provider
   * failed. The microphone is already off; `finish` still returns what was
   * recognized up to that point.
   */
  onError: (error: Error) => void
}

export interface LiveDictation {
  /** Resolves once the microphone records; the provider connects meanwhile */
  start: (request: LiveDictationStart) => Promise<void>
  /** Stops the microphone and waits for the provider's last words */
  finish: () => Promise<string>
  cancel: () => Promise<void>
}

/** One dictation at a time: the microphone streamed to a live transcription. */
export function createLiveDictation(deps: LiveDictationDeps): LiveDictation {
  let controller: AbortController | undefined
  let session: Promise<void> | undefined
  let state = createLiveTranscriptState()
  let failure: Error | undefined
  let finishing = false

  const stopCapture = () => deps.capture.stop().catch(() => undefined)

  return {
    async start(request) {
      controller?.abort()
      await session
      const current = new AbortController()
      controller = current
      state = createLiveTranscriptState()
      failure = undefined
      finishing = false

      const { sampleRate, audio } = await deps.capture.start()
      const parts = deps.stt.transcribeLive({
        model: request.model,
        audio,
        sampleRate,
        language: request.language,
        hasApiKey: request.hasApiKey,
        signal: current.signal,
      })

      session = (async () => {
        try {
          for await (const part of parts) {
            if (part.type === 'error') {
              throw new Error(part.message)
            }
            const next = applyTranscriptPart(state, part)
            if (next !== state) {
              state = next
              request.onText(state)
            }
          }
          if (!finishing && !current.signal.aborted) {
            throw new Error(
              'The speech recognition session closed while recording'
            )
          }
        } catch (error) {
          if (current.signal.aborted) return
          failure = error instanceof Error ? error : new Error(String(error))
          await stopCapture()
          request.onError(failure)
        }
      })()
    },

    async finish() {
      finishing = true
      await deps.capture.stop()
      // a provider that never closes must not hold the text hostage
      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          failure ??= new Error(
            'Timed out waiting for the speech recognition result'
          )
          controller?.abort()
          resolve()
        }, deps.finishTimeoutMs ?? FINISH_TIMEOUT_MS)
      })
      await Promise.race([session, timedOut])
      clearTimeout(timer)
      if (failure && !liveTranscriptText(state)) throw failure
      return liveTranscriptText(state)
    },

    async cancel() {
      controller?.abort()
      await stopCapture()
      await session
    },
  }
}
