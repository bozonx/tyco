import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

import {
  cloneTransformationLibrary,
  placeNewTransformation,
  type TransformationLibrary,
} from './transformation-library'

export type { TransformationConfig } from '@tyco/shared'

const NAME_LIMIT = 32

const hasId = (item: { id?: unknown } | null | undefined): boolean =>
  typeof item?.id === 'string' && item.id.trim() !== ''

/** An id no transformation has yet: `transformation-<n>` */
export function newTransformationId(
  items: readonly ({ id?: unknown } | null | undefined)[]
): string {
  const used = new Set(items.map((item) => (hasId(item) ? item!.id : null)))
  let n = 1
  while (used.has(`transformation-${n}`)) n += 1
  return `transformation-${n}`
}

/**
 * A short name of a transformation saved from an own request: its first line,
 * cut
 */
export function transformationNameFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0]?.trim() ?? ''

  if (firstLine.length <= NAME_LIMIT) return firstLine

  return `${firstLine.slice(0, NAME_LIMIT - 1).trimEnd()}…`
}

/**
 * The transformation library with `prompt` saved in the first free slot, or
 * null when all slots are taken. A request already saved is not added twice.
 */
export function addTransformationFromPrompt(
  library: TransformationLibrary,
  prompt: string
): TransformationLibrary | null {
  const rule = prompt.trim()

  if (!rule) return null
  if (library.items.some((item) => item.rule.trim() === rule))
    return cloneTransformationLibrary(library)

  const index = SHORTCUT_SLOT_KEYS.findIndex((key) => !library.slots[key])
  if (index < 0) return null

  return placeNewTransformation(library, index, {
    id: newTransformationId(library.items),
    name: transformationNameFromPrompt(rule),
    rule,
  })
}
