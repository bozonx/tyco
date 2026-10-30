import { ref } from 'vue'

import {
  type TimerDependencies,
  createSingleTimer,
} from '../timers/single-timer'

export const DEFAULT_LIVE_DEBOUNCE_MS = 900
export const DEFAULT_BOUNDARY_COOLDOWN_MS = 2000
export const DEFAULT_TYPING_TIMEOUT_MS = 3500
export const DEFAULT_MIN_LIVE_LENGTH = 4

export type LiveCorrectionStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface LiveCorrectionDependencies extends TimerDependencies {
  correct: (text: string, signal: AbortSignal) => Promise<string>
  debounceMs?: number
  boundaryCooldownMs?: number
  typingTimeoutMs?: number
  minLength?: number
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
 */
export function createLiveCorrection(deps: LiveCorrectionDependencies) {
  const timer = createSingleTimer(deps)
  const now = deps.now ?? (() => Date.now())
  const debounceMs = deps.debounceMs ?? DEFAULT_LIVE_DEBOUNCE_MS
  const boundaryCooldownMs =
    deps.boundaryCooldownMs ?? DEFAULT_BOUNDARY_COOLDOWN_MS
  const typingTimeoutMs = deps.typingTimeoutMs ?? DEFAULT_TYPING_TIMEOUT_MS
  const minLength = deps.minLength ?? DEFAULT_MIN_LIVE_LENGTH

  const status = ref<LiveCorrectionStatus>('idle')
  const correctedText = ref<string>('')
  const error = ref<unknown>(null)

  let isDisposed = false
  let activeRun: ActiveRun | null = null
  let lastRequestedText = ''
  let lastResolvedText = ''
  let lastRequestTime = 0
  let typingStartTime = 0
  let latestText = ''

  const abortActive = () => {
    if (activeRun) {
      activeRun.controller.abort()
      activeRun = null
    }
  }

  const getCachedCorrection = (text: string): string | undefined => {
    if (!correctedText.value) return undefined
    if (text === lastResolvedText || text === correctedText.value) {
      return correctedText.value
    }
    return undefined
  }

  const schedulePending = () => {
    if (
      isDisposed ||
      activeRun ||
      latestText.trim().length < minLength ||
      getCachedCorrection(latestText) !== undefined ||
      latestText === lastRequestedText
    ) {
      return
    }
    timer.start(() => {
      if (
        !activeRun &&
        latestText.trim().length >= minLength &&
        getCachedCorrection(latestText) === undefined &&
        latestText !== lastRequestedText
      ) {
        void sendRequest(latestText).catch(() => {})
      }
    }, debounceMs)
  }

  const sendRequest = (text: string): Promise<string> => {
    if (isDisposed) return Promise.resolve(text)

    abortActive()

    const controller = new AbortController()
    lastRequestedText = text
    lastRequestTime = now()
    typingStartTime = 0
    status.value = 'loading'
    error.value = null

    const run: ActiveRun = {
      text,
      controller,
      promise: deps.correct(text, controller.signal).then(
        (result) => {
          if (controller.signal.aborted) return result
          if (activeRun === run) {
            activeRun = null
            lastResolvedText = text
            correctedText.value = result
            status.value = 'ready'
            schedulePending()
          }
          return result
        },
        (err: unknown) => {
          if (controller.signal.aborted) throw err
          if (activeRun === run) {
            activeRun = null
            error.value = err
            status.value = 'error'
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
    return await sendRequest(text)
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
