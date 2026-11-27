/**
 * How long a history is kept, as one choice of the settings: not at all, while
 * the app runs (the editor history only) or on the disk for a number of days, 0
 * for forever
 */
export type HistoryKeepingChoice = 'off' | 'session' | number

/** A history section of the config, as its settings edit it */
export interface KeptHistoryConfig {
  storage: 'off' | 'session' | 'disk'
  /** Absent: kept forever */
  retentionDays?: number
}

/** The choice the stored settings make */
export function historyKeepingChoice(
  history: KeptHistoryConfig
): HistoryKeepingChoice {
  if (history.storage === 'off' || history.storage === 'session') {
    return history.storage
  }
  return history.retentionDays ?? 0
}

/**
 * The select options: off, while the app runs when `canKeepInSession`, the
 * periods of `days` from the shortest, and forever last
 */
export function historyKeepingOptions(
  days: readonly number[],
  labels: {
    off: string
    session?: string
    forever: string
    period: (days: number) => string
  }
): { id: HistoryKeepingChoice; name: string }[] {
  return [
    { id: 'off' as const, name: labels.off },
    ...(labels.session
      ? [{ id: 'session' as const, name: labels.session }]
      : []),
    ...days
      .filter((day) => day > 0)
      .map((day) => ({ id: day, name: labels.period(day) })),
    { id: 0, name: labels.forever },
  ]
}

/**
 * Applies a choice to `history`; returns false for a value that is no choice.
 *
 * Never delete the history, or ask whether to delete it, when it is turned off
 * or kept in another way: a setting only says what is recorded and for how
 * long. What is stored stays until the user clears it with the delete button of
 * the section, a separate action with its own confirmation.
 */
export function applyHistoryKeeping(
  history: KeptHistoryConfig,
  value: string | number | undefined
): boolean {
  if (value === 'off' || value === 'session') {
    history.storage = value
    return true
  }
  if (value === undefined || value === '') return false
  const days = Number(value)
  if (!Number.isSafeInteger(days) || days < 0) return false
  history.storage = 'disk'
  if (days) history.retentionDays = days
  else delete history.retentionDays
  return true
}
