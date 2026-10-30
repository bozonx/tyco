import { ref } from 'vue'

import { LlmError } from '../llm/llm-client'
import {
  type TimerDependencies,
  createSingleTimer,
} from '../timers/single-timer'

export const DEFAULT_LIVE_DEBOUNCE_MS = 900
export const DEFAULT_BOUNDARY_COOLDOWN_MS = 2000
export const DEFAULT_TYPING_TIMEOUT_MS = 3500
export const DEFAULT_MIN_LIVE_LENGTH = 4
/** A speculative request that hangs must not block live correction for long */
export const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 15_000
/** The final correction the user waits for may take longer than a preview */
export const DEFAULT_FINAL_REQUEST_TIMEOUT_MS = 60_000

export type LiveCorrectionStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The model did not answer in time; the request was aborted */
export class LiveCorrectionTimeoutError extends LlmError {
  constructor() {
    // an empty detail: the localized timeout summary says it all
    super('timeout', '')
    this.name = 'LiveCorrectionTimeoutError'
  }
}

export interface LiveCorrectionDependencies extends TimerDependencies {
  correct: (text: string, signal: AbortSignal) => Promise<string>
  debounceMs?: number
  boundaryCooldownMs?: number
  typingTimeoutMs?: number
  minLength?: number
  requestTimeoutMs?: number
  finalRequestTimeoutMs?: number
  now?: () => number
}

interface ActiveRun {
  text: string
  controller: AbortController
  promise: Promise<string>
}

/**
 * Manages live, speculative text correction for quick text input:
 *
 * - Debounces rapid typing and skips very short fragments.
 * - Triggers early on sentence boundaries (punctuation + space) and word
 *   boundaries after sustained typing.
 * - Coalesces typing while a request is already in flight instead of aborting it
 *   mid-stream, preserving intermediate feedback and token budget.
 * - Avoids duplicate requests when text has not changed, is already resolved, or
 *   matches the accepted correction.
 * - Bounds every request by a timeout, so a dead connection fails fast instead of
 *   freezing the preview, and does not retry a failed text on its own.
 */
export function createLiveCorrection(deps: LiveCorrectionDependencies) {
  const timer = createSingleTimer(deps)
  const requestTimer = createSingleTimer(deps)
  const now = deps.now ?? (() => Date.now())
  const debounceMs = deps.debounceMs ?? DEFAULT_LIVE_DEBOUNCE_MS
  const boundaryCooldownMs =
    deps.boundaryCooldownMs ?? DEFAULT_BOUNDARY_COOLDOWN_MS
  const typingTimeoutMs = deps.typingTimeoutMs ?? DEFAULT_TYPING_TIMEOUT_MS
  const minLength = deps.minLength ?? DEFAULT_MIN_LIVE_LENGTH
  const requestTimeoutMs =
    deps.requestTimeoutMs ?? DEFAULT_LIVE_REQUEST_TIMEOUT_MS
  const finalRequestTimeoutMs =
    deps.finalRequestTimeoutMs ?? DEFAULT_FINAL_REQUEST_TIMEOUT_MS

  const status = ref<LiveCorrectionStatus>('idle')
  const correctedText = ref<string>('')
  const error = ref<unknown>(null)

  let isDisposed = false
  let activeRun: ActiveRun | null = null
  let lastRequestedText = ''
  let lastResolvedText = ''
  // a failed text is not retried on its own: offline, it would fail forever
  let lastFailedText = ''
  let lastRequestTime = 0
  let typingStartTime = 0
  let latestText = ''

  const abortActive = () => {
    if (activeRun) {
      requestTimer.stop()
      activeRun.controller.abort()
      activeRun = null
      lastRequestedText = lastResolvedText
    }
  }

  const getCachedCorrection = (text: string): string | undefined => {
    if (!correctedText.value) return undefined
    if (text === lastResolvedText || text === correctedText.value) {
      return correctedText.value
    }
    return undefined
  }

  const canRequest = (text: string) =>
    !activeRun &&
    text.trim().length >= minLength &&
    getCachedCorrection(text) === undefined &&
    text !== lastRequestedText &&
    text !== lastFailedText

  const schedulePending = () => {
    if (isDisposed || !canRequest(latestText)) return
    timer.start(() => {
      if (canRequest(latestText)) {
        // the failure lands in `error` and `status`, where the UI shows it
        void sendRequest(latestText).catch(() => {})
      }
    }, debounceMs)
  }

  const sendRequest = (
    text: string,
    timeoutMs: number = requestTimeoutMs
  ): Promise<string> => {
    if (isDisposed) return Promise.resolve(text)

    abortActive()

    const controller = new AbortController()
    lastRequestedText = text
    lastRequestTime = now()
    typingStartTime = 0
    status.value = 'loading'
    error.value = null
    let isTimedOut = false

    // a hung connection may ignore the abort: the timeout rejects on its own
    const request = new Promise<string>((resolve, reject) => {
      requestTimer.start(() => {
        isTimedOut = true
        reject(new LiveCorrectionTimeoutError())
        controller.abort()
      }, timeoutMs)
      deps.correct(text, controller.signal).then(resolve, reject)
    })

    const run: ActiveRun = {
      text,
      controller,
      promise: request.then(
        (result) => {
          if (controller.signal.aborted) return result
          if (activeRun === run) {
            requestTimer.stop()
            activeRun = null
            lastResolvedText = text
            lastFailedText = ''
            correctedText.value = result
            status.value = 'ready'
            schedulePending()
          }
          return result
        },
        (err: unknown) => {
          if (controller.signal.aborted && !isTimedOut) throw err
          if (activeRun === run) {
            requestTimer.stop()
            activeRun = null
            lastRequestedText = lastResolvedText
            lastFailedText = text
            error.value = err
            status.value = 'error'
            // the user kept typing meanwhile: the newer text gets its chance
            schedulePending()
          }
          throw err
        }
      ),
    }

    activeRun = run
    return run.promise
  }

  const handleInput = (text: string) => {
    if (isDisposed) return
    latestText = text

    if (!text.trim()) {
      reset()
      return
    }

    // Already resolved for this exact input or user accepted the corrected text
    const cached = getCachedCorrection(text)
    if (cached !== undefined) {
      timer.stop()
      lastResolvedText = text
      correctedText.value = cached
      status.value = 'ready'
      return
    }

    if (text.trim().length < minLength) {
      timer.stop()
      return
    }

    // Coalesce while a request is already in flight; follow-up runs on completion
    if (activeRun) {
      timer.stop()
      return
    }

    if (typingStartTime === 0) {
      typingStartTime = now()
    }

    const timeSinceLastRequest = now() - lastRequestTime
    const isSentenceBoundary = /[.!?\n]\s+$/.test(text)
    const isTimeoutSpace =
      text.endsWith(' ') && now() - typingStartTime >= typingTimeoutMs

    const isBoundaryTrigger =
      (isSentenceBoundary || isTimeoutSpace) &&
      timeSinceLastRequest >= boundaryCooldownMs

    if (isBoundaryTrigger) {
      timer.stop()
      // the failure lands in `error` and `status`, where the UI shows it
      void sendRequest(text).catch(() => {})
      return
    }

    schedulePending()
  }

  const getFinalCorrection = async (text: string): Promise<string> => {
    if (!text.trim()) return ''
    const cached = getCachedCorrection(text)
    if (cached !== undefined) {
      return cached
    }
    if (text === lastRequestedText && activeRun) {
      return await activeRun.promise
    }
    timer.stop()
    // the user asked for it: a text that failed before is tried again
    return await sendRequest(text, finalRequestTimeoutMs)
  }

  const cancel = () => {
    timer.stop()
    abortActive()
    if (status.value === 'loading') {
      status.value = lastResolvedText ? 'ready' : 'idle'
    }
  }

  const reset = () => {
    cancel()
    lastRequestedText = ''
    lastResolvedText = ''
    lastFailedText = ''
    correctedText.value = ''
    error.value = null
    status.value = 'idle'
    typingStartTime = 0
    latestText = ''
  }

  const invalidate = () => {
    reset()
  }

  const dispose = () => {
    isDisposed = true
    reset()
  }

  return {
    status,
    correctedText,
    error,
    getCachedCorrection,
    handleInput,
    getFinalCorrection,
    cancel,
    reset,
    invalidate,
    dispose,
  }
}

export type LiveCorrection = ReturnType<typeof createLiveCorrection>
