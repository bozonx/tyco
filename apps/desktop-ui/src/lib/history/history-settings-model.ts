import { shallowRef } from 'vue'

import { isStricterRetention } from './history-retention'

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

interface PendingHistoryChange {
  message: string
  apply: () => void
}

/**
 * Edits how long a history is kept.
 *
 * Do not ask to delete, or delete, the history when it is turned off or kept in
 * another way: turning it off only stops recording, and what is stored stays
 * until the user clears it with the clear button of the section, a separate
 * action with its own confirmation. The only change that waits for confirmation
 * is a shorter retention period, which removes what is older at once.
 */
export function createHistoryKeepingModel(deps: {
  getHistory: () => KeptHistoryConfig
  /** The config section to change, created when the config lacks it */
  editHistory?: () => KeptHistoryConfig
  retentionMessage: (days: number) => string
}) {
  const edit = deps.editHistory ?? deps.getHistory
  const pendingChange = shallowRef<PendingHistoryChange | null>(null)
  const cancelChange = () => {
    pendingChange.value = null
  }
  const confirmChange = () => {
    const change = pendingChange.value
    pendingChange.value = null
    change?.apply()
  }
  const setKeeping = (value: string | number | undefined) => {
    pendingChange.value = null
    if (value === 'off' || value === 'session') {
      edit().storage = value
      return
    }
    const days = Number(value)
    if (value === undefined || value === '') return
    if (!Number.isSafeInteger(days) || days < 0) return
    const apply = () => {
      const history = edit()
      history.storage = 'disk'
      if (days) history.retentionDays = days
      else delete history.retentionDays
    }
    if (isStricterRetention(deps.getHistory().retentionDays, days)) {
      pendingChange.value = { message: deps.retentionMessage(days), apply }
    } else apply()
  }
  return { pendingChange, confirmChange, cancelChange, setKeeping }
}
