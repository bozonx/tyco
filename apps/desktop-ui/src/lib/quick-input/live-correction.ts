import { ref } from 'vue'

import {
  type TimerDependencies,
  createSingleTimer,
} from '../timers/single-timer'

export const DEFAULT_LIVE_DEBOUNCE_MS = 500
export const DEFAULT_BOUNDARY_COOLDOWN_MS = 1200
export const DEFAULT_TYPING_TIMEOUT_MS = 2500

export type LiveCorrectionStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface LiveCorrectionDependencies extends TimerDependencies {
  correct: (text: string, signal: AbortSignal) => Promise<string>
  debounceMs?: number
  boundaryCooldownMs?: number
  typingTimeoutMs?: number
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
 * - Debounces rapid typing by default.
 * - Triggers early on sentence or clause boundaries (punctuation + space) and
 *   word boundaries after sustained typing.
 * - Avoids duplicate requests when text has not changed or is already resolved.
 * - Yields the final resolved correction immediately on completion.
 */
export function createLiveCorrection(deps: LiveCorrectionDependencies) {
  const timer = createSingleTimer(deps)
  const now = deps.now ?? (() => Date.now())
  const debounceMs = deps.debounceMs ?? DEFAULT_LIVE_DEBOUNCE_MS
  const boundaryCooldownMs =
    deps.boundaryCooldownMs ?? DEFAULT_BOUNDARY_COOLDOWN_MS
  const typingTimeoutMs = deps.typingTimeoutMs ?? DEFAULT_TYPING_TIMEOUT_MS

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

    // Already fully resolved for this exact input
    if (text === lastResolvedText) {
      timer.stop()
      status.value = 'ready'
      return
    }

    // Identical request is already in flight
    if (text === lastRequestedText && activeRun) {
      timer.stop()
      return
    }

    if (typingStartTime === 0) {
      typingStartTime = now()
    }

    const timeSinceLastRequest = now() - lastRequestTime
    const isSentenceBoundary = /[.!?\n]\s+$/.test(text)
    const isClauseBoundary = /[,;:]\s+$/.test(text)
    const isTimeoutSpace =
      text.endsWith(' ') && now() - typingStartTime >= typingTimeoutMs

    const isBoundaryTrigger =
      (isSentenceBoundary || isClauseBoundary || isTimeoutSpace) &&
      timeSinceLastRequest >= boundaryCooldownMs

    if (isBoundaryTrigger) {
      timer.stop()
      void sendRequest(text).catch(() => {})
      return
    }

    // Schedule debounce: if typing pauses with unsent characters, summarize
    timer.start(() => {
      if (
        latestText.trim() &&
        latestText !== lastResolvedText &&
        latestText !== lastRequestedText
      ) {
        void sendRequest(latestText).catch(() => {})
      }
    }, debounceMs)
  }

  const getFinalCorrection = async (text: string): Promise<string> => {
    if (!text.trim()) return ''
    if (text === lastResolvedText && correctedText.value) {
      return correctedText.value
    }
    if (text === lastRequestedText && activeRun) {
      try {
        return await activeRun.promise
      } catch {
        return text
      }
    }
    timer.stop()
    try {
      return await sendRequest(text)
    } catch {
      return text
    }
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
    handleInput,
    getFinalCorrection,
    cancel,
    reset,
    invalidate,
    dispose,
  }
}

export type LiveCorrection = ReturnType<typeof createLiveCorrection>
