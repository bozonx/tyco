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
      item?.type === 'script' &&
      typeof item.id === 'string' &&
      item.id.trim()
    ) {
      return {
        type: 'script',
        id: item.id,
        name: typeof item.name === 'string' ? item.name : '',
        command: typeof item.command === 'string' ? item.command : '',
        logOutput: Boolean(item.logOutput),
      }
    }
    if (
      item?.type === 'webhook' &&
      typeof item.id === 'string' &&
      item.id.trim()
    ) {
      return {
        type: 'webhook',
        id: item.id,
        name: typeof item.name === 'string' ? item.name : '',
        url: typeof item.url === 'string' ? item.url : '',
        headers:
          item.headers && typeof item.headers === 'object'
            ? item.headers
            : undefined,
        payloadTemplate:
          typeof item.payloadTemplate === 'string'
            ? item.payloadTemplate
            : undefined,
        logOutput: Boolean(item.logOutput),
      }
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
