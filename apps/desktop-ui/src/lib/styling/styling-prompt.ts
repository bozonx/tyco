import { nameFromPrompt, nextNumberedId } from '../shortcut-slots/slot-prompt'
import { savePromptToSlotLibrary } from '../shortcut-slots/slot-library'
import type { StylingConfig } from '@tyco/shared'
import type { StylingLibrary } from './styling-library'

export type { StylingConfig } from '@tyco/shared'

const ID_PREFIX = 'style'

/** An id no style has yet: `style-<n>` */
export const newStylingId = (
  items: readonly ({ id?: unknown } | null | undefined)[]
): string => nextNumberedId(items, ID_PREFIX)

/** A short name of a styling preset saved from an own request */
export const stylingNameFromPrompt = nameFromPrompt

/** Saves `prompt` as a styling preset; see `savePromptToSlotLibrary` */
export const addStylingFromPrompt = (library: StylingLibrary, prompt: string) =>
  savePromptToSlotLibrary<StylingConfig, StylingLibrary>(
    library,
    prompt,
    ID_PREFIX
  )
