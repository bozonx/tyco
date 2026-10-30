import {
  firstFreeSlotIndex,
  nameFromPrompt,
  nextNumberedId,
} from '../shortcut-slots/slot-prompt'
import {
  cloneTransformationLibrary,
  placeNewTransformation,
  type TransformationLibrary,
} from './transformation-library'

export type { TransformationConfig } from '@tyco/shared'

/** An id no transformation has yet: `transformation-<n>` */
export const newTransformationId = (
  items: readonly ({ id?: unknown } | null | undefined)[]
): string => nextNumberedId(items, 'transformation')

/**
 * A short name of a transformation saved from an own request: its first line,
 * cut
 */
export const transformationNameFromPrompt = nameFromPrompt

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

  const index = firstFreeSlotIndex(library.slots)
  if (index < 0) return null

  return placeNewTransformation(library, index, {
    id: newTransformationId(library.items),
    name: transformationNameFromPrompt(rule),
    rule,
  })
}
