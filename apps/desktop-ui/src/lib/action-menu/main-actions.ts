import {
  DEFAULT_MAIN_ACTIONS,
  STANDARD_ACTION_IDS,
  type MainActionConfig,
  type StandardActionId,
} from '@tyco/shared'

import { normalizeShortcutSlots } from '../shortcut-slots/shortcut-slots'

const standardActionIds = new Set<string>(STANDARD_ACTION_IDS)

export function isStandardActionId(value: unknown): value is StandardActionId {
  return typeof value === 'string' && standardActionIds.has(value)
}

export function normalizeMainActions(
  value: unknown
): (MainActionConfig | null)[] {
  const source = Array.isArray(value) ? value : DEFAULT_MAIN_ACTIONS

  return normalizeShortcutSlots<MainActionConfig>(source).map((item) => {
    if (
      !item ||
      item.type !== 'standard' ||
      !isStandardActionId(item.actionId)
    ) {
      return null
    }

    return { type: 'standard', actionId: item.actionId }
  })
}
