import {
  type TimerDependencies,
  createSingleTimer,
} from '../timers/single-timer'

/** Why a recording stopped by itself */
export type AutoStopReason = 'limit' | 'silence'

/** A recording that is about to stop by itself */
export interface AutoStopWarning {
  reason: AutoStopReason
  /** When it stops, on the `now()` clock */
  deadlineMs: number
}

export interface VoiceSessionDependencies extends TimerDependencies {
  maxRecordingMs: number
  /** How long a recording may go on without recognized speech */
  silenceTimeoutMs: number
  /** How long before an automatic stop the user is warned */
  warningLeadMs: number
  now?: () => number
  onAutoStop: (reason: AutoStopReason) => void
  /** The pending automatic stop, or `undefined` once it is no longer near */
  onWarning: (warning: AutoStopWarning | undefined) => void
}

export interface VoiceSession {
  readonly signal: AbortSignal | undefined
  begin: () => AbortSignal
  /** Recognized speech: the silence deadline starts over */
  markActivity: () => void
  stopTimer: () => void
  abort: () => void
  dispose: () => void
}

/** Owns cancellation and the automatic stops of one voice UI instance. */
export function createVoiceSession(
  deps: VoiceSessionDependencies
): VoiceSession {
  const now = deps.now ?? (() => Date.now())
  const stopTimer = createSingleTimer(deps)
  const warningTimer = createSingleTimer(deps)
  let controller: AbortController | undefined
  let limitDeadlineMs: number | undefined
  let silenceDeadlineMs: number | undefined
  let warning: AutoStopWarning | undefined

  const setWarning = (next: AutoStopWarning | undefined) => {
    if (
      warning?.reason === next?.reason &&
      warning?.deadlineMs === next?.deadlineMs
    )
      return
    warning = next
    deps.onWarning(next)
  }

  const schedule = () => {
    stopTimer.stop()
    warningTimer.stop()
    if (limitDeadlineMs === undefined || silenceDeadlineMs === undefined) {
      setWarning(undefined)
      return
    }
    const next: AutoStopWarning =
      silenceDeadlineMs < limitDeadlineMs
        ? { reason: 'silence', deadlineMs: silenceDeadlineMs }
        : { reason: 'limit', deadlineMs: limitDeadlineMs }
    const remainingMs = next.deadlineMs - now()
    stopTimer.start(
      () => {
        clearDeadlines()
        deps.onAutoStop(next.reason)
      },
      Math.max(0, remainingMs)
    )
    const untilWarningMs = remainingMs - deps.warningLeadMs
    if (untilWarningMs <= 0) {
      setWarning(next)
      return
    }
    // speech pushed the stop away: the old countdown no longer holds
    setWarning(undefined)
    warningTimer.start(() => setWarning(next), untilWarningMs)
  }

  const clearDeadlines = () => {
    limitDeadlineMs = undefined
    silenceDeadlineMs = undefined
    schedule()
  }

  const abort = () => {
    clearDeadlines()
    controller?.abort()
  }

  return {
    get signal() {
      return controller?.signal
    },
    begin() {
      abort()
      controller = new AbortController()
      const startedAt = now()
      limitDeadlineMs = startedAt + deps.maxRecordingMs
      silenceDeadlineMs = startedAt + deps.silenceTimeoutMs
      schedule()
      return controller.signal
    },
    markActivity() {
      if (silenceDeadlineMs === undefined) return
      silenceDeadlineMs = now() + deps.silenceTimeoutMs
      schedule()
    },
    stopTimer: clearDeadlines,
    abort,
    dispose() {
      abort()
      controller = undefined
    },
  }
}
