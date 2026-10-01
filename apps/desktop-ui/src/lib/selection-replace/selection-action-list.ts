import { type UserConfig, selectionActionId } from '@tyco/shared'

/** A selection action the settings offer a hotkey for. */
export interface SelectionActionEntry {
  /** The action id, the key in `userConfig.selectionHotkeys` */
  id: string
  kind: 'correction' | 'translate' | 'aiTask'
  /** The target language of a translation */
  language?: string
  /** The name of an AI task */
  taskName?: string
  defaultShortcut?: string
}

/**
 * Correction, a translation into every configured language and every AI task;
 * empty slots are skipped but keep the numbering of the others
 */
export function listSelectionActions(
  userConfig: Pick<UserConfig, 'toTranslateLanguages' | 'aiTasks'>,
  defaults: Record<string, string> = {}
): SelectionActionEntry[] {
  const entries: SelectionActionEntry[] = [
    { id: 'correction', kind: 'correction' },
  ]
  ;(userConfig.toTranslateLanguages ?? []).forEach((language, slot) => {
    if (!language) return
    entries.push({
      id: selectionActionId({ kind: 'translate', slot }),
      kind: 'translate',
      language,
    })
  })
  ;(userConfig.aiTasks ?? []).forEach((task, slot) => {
    if (!task) return
    entries.push({
      id: selectionActionId({ kind: 'aiTask', slot }),
      kind: 'aiTask',
      taskName: task.name,
    })
  })
  return entries.map((entry) =>
    defaults[entry.id]
      ? { ...entry, defaultShortcut: defaults[entry.id] }
      : entry
  )
}
