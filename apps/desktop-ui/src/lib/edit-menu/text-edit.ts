import type { EditItem } from './edit-menu-store'

export interface TextEditSnapshot {
  text: string
  selectedText: string
  from: number
  to: number
}
export interface TextEditDependencies {
  snapshot: () => TextEditSnapshot
  replaceSelection: (text: string) => void
  replaceText: (text: string) => void
}

/** Do not apply delayed formatter results to a changed document or selection. */
export function createTextEditModel(deps: TextEditDependencies) {
  const run = async (item: EditItem) => {
    const before = { ...deps.snapshot() }
    const selected =
      before.selectedText.trim() !== '' && before.from !== before.to
    if (item.selectionOnly && !selected) return 'empty' as const
    const input = selected ? before.selectedText : before.text
    if (!input.trim()) return 'empty' as const
    const result = await item.action(input)
    const after = deps.snapshot()
    if (
      before.text !== after.text ||
      before.from !== after.from ||
      before.to !== after.to ||
      before.selectedText !== after.selectedText
    )
      return 'stale' as const
    if (selected) deps.replaceSelection(result)
    else deps.replaceText(result)
    return 'applied' as const
  }
  return { run }
}
