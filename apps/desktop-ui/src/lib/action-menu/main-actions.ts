import {
  CUSTOM_ACTION_AFTER_RUN,
  type CustomActionAfterRun,
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

const stringOr = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const afterRunOf = (value: unknown): CustomActionAfterRun =>
  CUSTOM_ACTION_AFTER_RUN.includes(value as CustomActionAfterRun)
    ? (value as CustomActionAfterRun)
    : 'none'

function headersOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
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
        name: stringOr(item.name),
        command: stringOr(item.command),
        workingDir: stringOr(item.workingDir),
        afterRun: afterRunOf(item.afterRun),
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
        name: stringOr(item.name),
        url: stringOr(item.url),
        method: item.method === 'GET' ? 'GET' : 'POST',
        headers: headersOf(item.headers),
        payloadTemplate: stringOr(item.payloadTemplate),
        authSecret: Boolean(item.authSecret),
        afterRun: afterRunOf(item.afterRun),
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
