import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

import {
  cloneStylingLibrary,
  placeNewStyling,
  type StylingLibrary,
} from './styling-library'

export type { StylingConfig } from '@tyco/shared'

const NAME_LIMIT = 32

const hasId = (item: { id?: unknown } | null | undefined): boolean =>
  typeof item?.id === 'string' && item.id.trim() !== ''

/** An id no style has yet: `style-<n>` */
export function newStylingId(
  items: readonly ({ id?: unknown } | null | undefined)[]
): string {
  const used = new Set(items.map((item) => (hasId(item) ? item!.id : null)))
  let n = 1
  while (used.has(`style-${n}`)) n += 1
  return `style-${n}`
}

/**
 * A short name of a styling preset saved from an own request: its first line,
 * cut
 */
export function stylingNameFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0]?.trim() ?? ''

  if (firstLine.length <= NAME_LIMIT) return firstLine

  return `${firstLine.slice(0, NAME_LIMIT - 1).trimEnd()}…`
}

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

  const index = SHORTCUT_SLOT_KEYS.findIndex((key) => !library.slots[key])
  if (index < 0) return null

  return placeNewStyling(library, index, {
    id: newStylingId(library.items),
    name: stylingNameFromPrompt(rule),
    rule,
  })
}
