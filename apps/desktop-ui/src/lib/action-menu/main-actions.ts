import {
  DEFAULT_MAIN_ACTIONS,
  STANDARD_ACTION_IDS,
  type MainActionConfig,
  type StandardActionId,
} from '@tyco/shared'

import { PRESETS_KEYS } from '../../types'

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
      item?.type === 'plugin' &&
      typeof item.actionId === 'string' &&
      item.actionId.trim()
    ) {
      return { type: 'plugin', actionId: item.actionId }
    }
    if (
      item?.type === 'command' &&
      typeof item.commandId === 'string' &&
      item.commandId.trim()
    ) {
      return { type: 'command', commandId: item.commandId }
    }
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

export function assignPluginActions(
  value: unknown,
  actions: readonly { id?: string; preferredKey?: string }[],
  registrations: readonly string[] = []
): (MainActionConfig | null)[] {
  const slots = normalizeMainActions(value)
  for (const action of actions) {
    if (
      !action.id ||
      registrations.includes(action.id) ||
      slots.some(
        (slot) => slot?.type === 'plugin' && slot.actionId === action.id
      )
    )
      continue
    const preferred = PRESETS_KEYS.indexOf(
      action.preferredKey?.toLowerCase() ?? ''
    )
    const index =
      preferred >= 0 && !slots[preferred]
        ? preferred
        : slots.findIndex((slot) => !slot)
    if (index >= 0) slots[index] = { type: 'plugin', actionId: action.id }
  }
  return slots
}
