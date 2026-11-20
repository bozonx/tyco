import type { ShortcutSlots } from '@tyco/shared'

import { COMMON_LANGUAGE_OPTIONS } from '../locale/language'
import { slotList } from '../shortcut-slots/shortcut-slots'

export interface DialogLanguageOption {
  /** Empty: no translation */
  id: string
  name: string
}

/**
 * The languages the other side can be translated into: off, then the target
 * languages of the translation menu, then the common ones. The current choice
 * stays listed even when it is none of them.
 */
export function dialogLanguageOptions(options: {
  targetLanguages: ShortcutSlots<string> | undefined
  current: string
  offLabel: string
  labelOf: (id: string) => string
}): DialogLanguageOption[] {
  const ids: string[] = []
  const add = (id: string | null | undefined) => {
    const trimmed = id?.trim()
    if (trimmed && !ids.includes(trimmed)) ids.push(trimmed)
  }
  slotList(options.targetLanguages).forEach(add)
  add(options.current)
  COMMON_LANGUAGE_OPTIONS.forEach((option) => add(option.id))
  return [
    { id: '', name: options.offLabel },
    ...ids.map((id) => ({ id, name: options.labelOf(id) })),
  ]
}
