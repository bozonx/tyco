import {
  type TimerDependencies,
  createSingleTimer,
} from '../timers/single-timer'

export interface VoiceSessionDependencies extends TimerDependencies {
  maxRecordingMs: number
  onLimit: () => void
}

export interface VoiceSession {
  readonly signal: AbortSignal | undefined
  begin: () => AbortSignal
  stopTimer: () => void
  abort: () => void
  dispose: () => void
}

/** Owns cancellation and the recording deadline for one voice UI instance. */
export function createVoiceSession(
  deps: VoiceSessionDependencies
): VoiceSession {
  const limitTimer = createSingleTimer(deps)
  let controller: AbortController | undefined
  const stopTimer = limitTimer.stop

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
      limitTimer.start(deps.onLimit, deps.maxRecordingMs)
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
