import type { TranscriptPart } from '@bozonx/ai-kit'

import {
  applyTranscriptPart,
  createLiveTranscriptState,
  type LiveTranscriptState,
  liveTranscriptText,
} from './live-transcript'
import type { SttClient } from './stt-client'
import type { SttModel } from './stt-config'
import type { CaptureSource } from '@tyco/shared'
import type {
  CaptureSourceHandlers,
  VoiceCaptureControl,
} from './voice-capture'
import { asDictationError, DictationError } from './dictation-error'

/** How long the provider may take for its last words once the audio ends */
const FINISH_TIMEOUT_MS = 10_000
/**
 * How long an aborted session may take to wind down. A provider stream that
 * ignores the abort must not block every later dictation.
 */
const CANCEL_TIMEOUT_MS = 5_000

/** Waits for `promise`, but no longer than `ms` */
async function settleWithin(
  promise: Promise<unknown> | undefined,
  ms: number
): Promise<void> {
  if (!promise) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    promise.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms)
    }),
  ])
  clearTimeout(timer)
}

export interface LiveDictationDependencies {
  capture: VoiceCaptureControl
  stt: SttClient
  finishTimeoutMs?: number
  cancelTimeoutMs?: number
}

export interface LiveDictationStart extends CaptureSourceHandlers {
  /** What is recorded: the microphone by default */
  source?: CaptureSource
  /** Preferred input device when recording the microphone */
  microphoneId?: string
  model: SttModel
  language?: string
  hasApiKey: boolean
  isContinuous?: boolean
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
  /** Records another playback source; the provider hears one stream */
  switchSource: (source: CaptureSource) => Promise<void>
}

/** One dictation at a time: the microphone streamed to a live transcription. */
export function createLiveDictation(
  deps: LiveDictationDependencies
): LiveDictation {
  let controller: AbortController | undefined
  let session: Promise<void> | undefined
  let state = createLiveTranscriptState()
  let failure: Error | undefined
  let finishing = false
  let onError: ((error: Error) => void) | undefined

  const stopCapture = () => deps.capture.stop().catch(() => undefined)
  const settleSession = () =>
    settleWithin(session, deps.cancelTimeoutMs ?? CANCEL_TIMEOUT_MS)

  return {
    async start(request) {
      controller?.abort()
      await settleSession()
      const current = new AbortController()
      controller = current
      state = createLiveTranscriptState()
      failure = undefined
      finishing = false
      onError = request.onError

      let capture: Awaited<ReturnType<VoiceCaptureControl['start']>>
      try {
        capture = await deps.capture.start(
          request.source,
          { onWaiting: request.onWaiting, onSourceLost: request.onSourceLost },
          request.microphoneId
        )
      } catch (error) {
        throw asDictationError('microphone', error)
      }
      const { sampleRate, isSuperseded } = capture
      // the provider reports a broken audio stream in words of its own: the
      // microphone's failure is kept to be told as it is
      let captureFailure: unknown
      const audio = (async function* () {
        try {
          yield* capture.audio
        } catch (error) {
          captureFailure = error
          throw error
        }
      })()
      // cancelled while the microphone was starting: it must not stay on
      if (current.signal.aborted) {
        await stopCapture()
        return
      }
      let parts: AsyncIterable<TranscriptPart>
      try {
        parts = deps.stt.transcribeLive({
          model: request.model,
          audio,
          sampleRate,
          language: request.language,
          hasApiKey: request.hasApiKey,
          isContinuous: request.isContinuous,
          signal: current.signal,
        })
      } catch (error) {
        await stopCapture()
        throw asDictationError('provider', error)
      }

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
            throw isSuperseded()
              ? new DictationError(
                  'superseded',
                  'Another voice input took the microphone over'
                )
              : new DictationError(
                  'closed',
                  'The speech recognition session closed while recording'
                )
          }
        } catch (error) {
          if (current.signal.aborted) return
          failure =
            captureFailure !== undefined
              ? asDictationError('microphoneLost', captureFailure)
              : asDictationError('provider', error)
          await stopCapture()
          request.onError(failure)
        }
      })()
    },

    async finish() {
      finishing = true
      // a microphone that failed to stop must not cost the text: the wait
      // below is bounded
      // a provider that never closes must not hold the text hostage
      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          if (!failure) {
            failure = new DictationError(
              'timeout',
              'Timed out waiting for the speech recognition result'
            )
            onError?.(failure)
          }
          controller?.abort()
          resolve()
        }, deps.finishTimeoutMs ?? FINISH_TIMEOUT_MS)
      })
      await Promise.race([stopCapture().then(() => session), timedOut])
      clearTimeout(timer)
      if (failure && !liveTranscriptText(state)) throw failure
      return liveTranscriptText(state)
    },

    switchSource: (source) => deps.capture.switchSource(source),

    async cancel() {
      controller?.abort()
      await stopCapture()
      await settleSession()
    },
  }
}
