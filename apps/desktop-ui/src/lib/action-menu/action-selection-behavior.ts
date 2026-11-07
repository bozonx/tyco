import {
  type CommandConfig,
  type MainActionConfig,
  commandTakesSelection,
} from '@tyco/shared'

import { commandTakesText } from '../commands/command-runtime'
import type { ToolLookup } from '../tools/tool-types'

export interface ActionSelectionBehavior {
  /** Whether the user cannot toggle the switch in the settings */
  disabled: boolean
  /** If locked, the forced value; if null, the slot config's takesSelection value applies */
  forcedValue: boolean | null
}

const LOCKED_TRUE_STANDARD_ACTIONS = new Set([
  'correction',
  'directCorrection',
  'translationMenu',
  'transformationMenu',
  'stylingMenu',
  'insertIntoWindow',
  'copyToClipboard',
])

const LOCKED_FALSE_STANDARD_ACTIONS = new Set([
  'screenshotQuickAiRequest',
  'voiceScreenshotQuickAiRequest',
  'voiceCommands',
  'favoritesMenu',
  'openHistory',
  'voiceInput',
])

export function resolveActionSelectionBehavior(
  action: MainActionConfig | null | undefined,
  commands?: readonly CommandConfig[],
  tools?: ToolLookup
): ActionSelectionBehavior {
  if (!action) {
    return { disabled: true, forcedValue: true }
  }

  switch (action.type) {
    case 'translation':
    case 'transformation':
    case 'styling':
      return { disabled: true, forcedValue: true }

    case 'profile':
      if (
        action.action === 'screenshotQuickAiRequest' ||
        action.action === 'voiceScreenshotQuickAiRequest'
      ) {
        return { disabled: true, forcedValue: false }
      }
      return { disabled: false, forcedValue: null }

    case 'profileChat':
      return { disabled: false, forcedValue: null }

    case 'standard':
      if (LOCKED_TRUE_STANDARD_ACTIONS.has(action.actionId)) {
        return { disabled: true, forcedValue: true }
      }
      if (LOCKED_FALSE_STANDARD_ACTIONS.has(action.actionId)) {
        return { disabled: true, forcedValue: false }
      }
      return { disabled: false, forcedValue: null }

    case 'command': {
      const command = commands?.find((c) => c.id === action.commandId)
      if (command) {
        if (commandTakesSelection(command)) {
          return { disabled: true, forcedValue: true }
        }
        if (tools && !commandTakesText(command, tools)) {
          return { disabled: true, forcedValue: false }
        }
      }
      return { disabled: false, forcedValue: null }
    }

    case 'plugin':
      return { disabled: false, forcedValue: null }
  }
}
