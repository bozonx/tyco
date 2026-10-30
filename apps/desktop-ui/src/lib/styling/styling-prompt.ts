import {
  firstFreeSlotIndex,
  nameFromPrompt,
  nextNumberedId,
} from '../shortcut-slots/slot-prompt'
import {
  cloneStylingLibrary,
  placeNewStyling,
  type StylingLibrary,
} from './styling-library'

export type { StylingConfig } from '@tyco/shared'

/** An id no style has yet: `style-<n>` */
export const newStylingId = (
  items: readonly ({ id?: unknown } | null | undefined)[]
): string => nextNumberedId(items, 'style')

/**
 * A short name of a styling preset saved from an own request: its first line,
 * cut
 */
export const stylingNameFromPrompt = nameFromPrompt

/**
 * The styling library with `prompt` saved in the first free slot, or null when
 * all slots are taken. A request already saved is not added twice.
 */
export function addStylingFromPrompt(
  library: StylingLibrary,
  prompt: string
): StylingLibrary | null {
  const rule = prompt.trim()

  if (!rule) return null
  if (library.items.some((item) => item.rule.trim() === rule))
    return cloneStylingLibrary(library)

  const index = firstFreeSlotIndex(library.slots)
  if (index < 0) return null

  return placeNewStyling(library, index, {
    id: newStylingId(library.items),
    name: stylingNameFromPrompt(rule),
    rule,
  })
}
