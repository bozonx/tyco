/**
 * Actions that replace the selection in the focused window with their result,
 * see `src-tauri/src/services/selection_replace.rs`
 */
export type SelectionAction = { kind: 'correction' }

export function parseSelectionAction(id: string): SelectionAction | null {
  return id === 'correction' ? { kind: 'correction' } : null
}
