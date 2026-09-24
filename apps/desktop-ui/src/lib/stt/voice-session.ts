export interface VoiceSessionDeps {
  maxRecordingMs: number
  onLimit: () => void
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

export interface VoiceSession {
  readonly signal: AbortSignal | undefined
  begin: () => AbortSignal
  stopTimer: () => void
  abort: () => void
  dispose: () => void
}

/** Owns cancellation and the recording deadline for one voice UI instance. */
export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  const setTimer = deps.setTimer ?? setTimeout
  const clearTimer = deps.clearTimer ?? clearTimeout
  let controller: AbortController | undefined
  let limitTimer: ReturnType<typeof setTimeout> | undefined

  const stopTimer = () => {
    if (limitTimer === undefined) return
    clearTimer(limitTimer)
    limitTimer = undefined
  }

  const abort = () => {
    stopTimer()
    controller?.abort()
  }

  return {
    get signal() {
      return controller?.signal
    },
    begin() {
      abort()
      controller = new AbortController()
      limitTimer = setTimer(() => {
        limitTimer = undefined
        deps.onLimit()
      }, deps.maxRecordingMs)
      return controller.signal
    },
    stopTimer,
    abort,
    dispose() {
      abort()
      controller = undefined
    },
  }
}
