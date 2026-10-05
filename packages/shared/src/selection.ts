import type { UserConfig } from './user-config'

/**
 * Actions that replace the selection in the focused window with their result,
 * see `src-tauri/src/services/selection_replace.rs`. Slots index the configured
 * translation languages and AI tasks
 */
export type SelectionAction =
  | { kind: 'correction' }
  | { kind: 'translate'; slot: number }
  | { kind: 'aiTask'; slot: number }
  /** A command of the library whose output replaces the selection */
  | { kind: 'command'; commandId: string }

/** Hotkey ids of selection actions carry this prefix, e.g. `replace.aiTask.0` */
export const SELECTION_HOTKEY_PREFIX = 'replace.'

/** Prefix of the selection action of a command, e.g. `command:<id>` */
export const COMMAND_SELECTION_PREFIX = 'command:'

export function parseSelectionAction(id: string): SelectionAction | null {
  if (id === 'correction') return { kind: 'correction' }
  if (id.startsWith(COMMAND_SELECTION_PREFIX)) {
    const commandId = id.slice(COMMAND_SELECTION_PREFIX.length)
    return commandId.trim() ? { kind: 'command', commandId } : null
  }
  const match = /^(translate|aiTask)\.(\d{1,3})$/.exec(id)
  if (!match) return null
  return { kind: match[1] as 'translate' | 'aiTask', slot: Number(match[2]) }
}

export function selectionActionId(action: SelectionAction): string {
  if (action.kind === 'correction') return 'correction'
  if (action.kind === 'command') {
    return `${COMMAND_SELECTION_PREFIX}${action.commandId}`
  }
  return `${action.kind}.${action.slot}`
}

export type SelectionRunErrorCode =
  'noTarget' | 'noSelection' | 'capture' | 'unsupported'

/** The selection captured for an action, or why there is none */
export interface SelectionRunEvent {
  runId: number
  action: string
  text?: string
  error?: { code: SelectionRunErrorCode; message: string }
  userConfig: UserConfig
}

export type SelectionFinishStatus =
  'pasted' | 'clipboard' | 'restored' | 'stale'

export type StatusOverlayKind = 'pending' | 'success' | 'info' | 'error'

export interface StatusOverlayRequest {
  kind: StatusOverlayKind
  text: string
  /** A hidden bubble shows up only after this delay */
  delayMs?: number
  hideAfterMs?: number
  /** Update a visible bubble, but do not show a hidden one */
  onlyIfVisible?: boolean
}
