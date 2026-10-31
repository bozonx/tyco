import { nameFromPrompt, nextNumberedId } from '../shortcut-slots/slot-prompt'
import { savePromptToSlotLibrary } from '../shortcut-slots/slot-library'
import type { TransformationConfig } from '@tyco/shared'
import type { TransformationLibrary } from './transformation-library'

export type { TransformationConfig } from '@tyco/shared'

const ID_PREFIX = 'transformation'

/** An id no transformation has yet: `transformation-<n>` */
export const newTransformationId = (
  items: readonly ({ id?: unknown } | null | undefined)[]
): string => nextNumberedId(items, ID_PREFIX)

/** A short name of a transformation saved from an own request */
export const transformationNameFromPrompt = nameFromPrompt

/** Saves `prompt` as a transformation; see `savePromptToSlotLibrary` */
export const addTransformationFromPrompt = (
  library: TransformationLibrary,
  prompt: string
) =>
  savePromptToSlotLibrary<TransformationConfig, TransformationLibrary>(
    library,
    prompt,
    ID_PREFIX
  )
