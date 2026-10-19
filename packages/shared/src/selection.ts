/**
 * Actions that replace the selection in the focused window with their result,
 * see `src-tauri/src/services/selection_replace.rs`
 */
export type SelectionAction =
  | { kind: 'correction' }
  /** A command of the library whose output replaces the selection */
  | { kind: 'command'; commandId: string }

/** Hotkey ids of selection actions carry this prefix, e.g. `replace.correction` */
export const SELECTION_HOTKEY_PREFIX = 'replace.'

/** Prefix of the selection action of a command, e.g. `command:<id>` */
export const COMMAND_SELECTION_PREFIX = 'command:'

export function parseSelectionAction(id: string): SelectionAction | null {
  if (id === 'correction') return { kind: 'correction' }
  if (id.startsWith(COMMAND_SELECTION_PREFIX)) {
    const commandId = id.slice(COMMAND_SELECTION_PREFIX.length)
    return commandId.trim() ? { kind: 'command', commandId } : null
  }
  return null
}
