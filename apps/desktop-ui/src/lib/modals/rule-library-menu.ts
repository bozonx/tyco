import type { CoreToolId, UserConfig } from '@tyco/shared'

import type {
  SavePromptOutcome,
  SavePromptResult,
  SlotLibrary,
  SlotLibraryItem,
} from '../shortcut-slots/slot-library'
import type { PendingModalParams } from './menu-modal-params'

type Library = SlotLibrary<SlotLibraryItem>

/** What sets a rule library menu apart: the styles or the transformations */
export interface RuleLibraryMenuKind {
  titleKey: string
  toolId: CoreToolId
  minTextLength: number
  pending: Omit<PendingModalParams, 'onCancel'>
  getLibrary: (config: UserConfig | undefined) => Library | undefined
  /** The config patch that stores the library */
  patchLibrary: (library: Library) => Partial<UserConfig>
  savePrompt: (
    library: Library,
    prompt: string
  ) => SavePromptResult<Library> | null
  /** Forgets the rule the step was opened to run, so it runs once */
  clearStartupItem: (stepId: number) => void
}

/** What the menu tells after saving an own request */
export const SAVE_PROMPT_MESSAGES: Record<
  SavePromptOutcome,
  { key: string; level: 'success' | 'info' | 'warn' }
> = {
  added: { key: 'menu.aiPromptSaved', level: 'success' },
  placed: { key: 'menu.aiPromptSaved', level: 'success' },
  exists: { key: 'menu.aiPromptAlreadySaved', level: 'info' },
  full: { key: 'menu.aiPromptSlotsFull', level: 'warn' },
}
