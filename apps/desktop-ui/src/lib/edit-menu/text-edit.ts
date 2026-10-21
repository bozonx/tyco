import type { EditorInputSnapshot } from '@tyco/plugin-sdk'
import type { EditItem } from './edit-menu-model'

export type TextEditSnapshot = EditorInputSnapshot
export interface TextEditDependencies {
  snapshot: () => TextEditSnapshot
  applyEdit: (
    snapshot: TextEditSnapshot,
    text: string,
    scope: 'selection' | 'document'
  ) => boolean
}

/** Do not apply delayed formatter results to a changed document or selection. */
export function createTextEditModel(deps: TextEditDependencies) {
  const run = async (item: EditItem) => {
    const before = { ...deps.snapshot() }
    const selected =
      before.selectedText.trim() !== '' &&
      before.selectionStart !== before.selectionEnd
    if (item.selectionOnly && !selected) return 'empty' as const
    const input = selected ? before.selectedText : before.value
    if (!input.trim()) return 'empty' as const
    const result = await item.action(input)
    if (typeof result !== 'string')
      throw new Error('Invalid text transform result')
    if (!deps.applyEdit(before, result, selected ? 'selection' : 'document'))
      return 'stale' as const
    return 'applied' as const
  }
  return { run }
}

/** Applies a supported case transform without changing whitespace. */
export function transformTextCase(text: string, caseType: string): string {
  if (caseType === 'uppercase') return text.toUpperCase()
  if (caseType === 'lowercase') return text.toLowerCase()
  return text
}
