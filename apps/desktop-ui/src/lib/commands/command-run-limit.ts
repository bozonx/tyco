import type { TimerDependencies } from '../timers/single-timer'
import { runTimeoutOf } from './command-config'

/** The code of a run stopped at the limit, as the backend job has it */
export const COMMAND_TIMED_OUT_CODE = 'TimedOut'

/** How a run within the limit ended */
export type LimitedRun<T> =
  { isTimedOut: false; value: T } | { isTimedOut: true; seconds: number }

/**
 * Runs `task` within `commandRunTimeoutSec`, the limit shared by all command
 * runs (0: unbounded). The task gets a signal that aborts with `signal` or at
 * the limit; at the limit the run ends at once, even when the task ignores the
 * abort, and its late result is dropped. The overlay runs are limited by the
 * backend job instead, see `services/external/jobs.rs`
 */
export async function runWithinCommandLimit<T>(
  limitSec: unknown,
  signal: AbortSignal | undefined,
  task: (signal: AbortSignal) => Promise<T>,
  timers: TimerDependencies = {}
): Promise<LimitedRun<T>> {
  const seconds = runTimeoutOf(limitSec)
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const setTimer =
    timers.setTimer ?? ((run, delayMs) => globalThis.setTimeout(run, delayMs))
  const clearTimer =
    timers.clearTimer ??
    ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>))
  let timer: unknown
  const timedOut = new Promise<LimitedRun<T>>((resolve) => {
    if (seconds === 0) return
    timer = setTimer(() => {
      abort()
      resolve({ isTimedOut: true, seconds })
    }, seconds * 1000)
  })
  try {
    return await Promise.race([
      task(controller.signal).then((value): LimitedRun<T> => ({
        isTimedOut: false,
        value,
      })),
      timedOut,
    ])
  } finally {
    if (timer !== undefined) clearTimer(timer)
    signal?.removeEventListener('abort', abort)
  }
}
