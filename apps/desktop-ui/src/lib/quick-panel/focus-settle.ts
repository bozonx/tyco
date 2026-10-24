import {
  type TimerDependencies,
  createSingleTimer,
} from '../timers/single-timer'

export interface FocusSettleOptions extends TimerDependencies {
  settleMs?: number
}

export function createFocusSettle(options: FocusSettleOptions) {
  const timer = createSingleTimer(options)
  let generation = 0

  const cancel = () => {
    generation += 1
    timer.stop()
    const currentGeneration = generation
    return () => currentGeneration === generation
  }

  const schedule = (run: (isCurrent: () => boolean) => void) => {
    const isCurrent = cancel()
    timer.start(() => run(isCurrent), options.settleMs ?? 150)
  }

  return { cancel, schedule }
}
