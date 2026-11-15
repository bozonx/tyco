/** What a stopped recording (an error or nothing heard) can offer next. */
export type StoppedRecordingAction = 'retry' | 'typeText' | 'openSettings'

export interface StoppedRecordingCapabilities {
  canRetry: boolean
  canTypeText?: boolean
  canOpenSettings: boolean
}

/** By priority: the first available one is the primary action. */
const PRIORITY: readonly StoppedRecordingAction[] = [
  'retry',
  'typeText',
  'openSettings',
]

/**
 * Splits the actions of a stopped recording into the primary one, bound to
 * Space/Enter and shown last on the right, and the others without hotkeys, in
 * their display order
 */
export function stoppedRecordingActions(
  capabilities: StoppedRecordingCapabilities
): {
  primary: StoppedRecordingAction | undefined
  others: StoppedRecordingAction[]
} {
  const available = PRIORITY.filter((action) => {
    if (action === 'retry') return capabilities.canRetry
    if (action === 'typeText') return capabilities.canTypeText === true
    return capabilities.canOpenSettings
  })
  const [primary, ...rest] = available
  // the others read from left to right: the least important leftmost
  return { primary, others: rest.reverse() }
}
