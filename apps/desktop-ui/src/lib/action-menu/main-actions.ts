import {
  DEFAULT_ACTION_PAGES,
  SHORTCUT_SLOT_KEYS,
  STANDARD_ACTION_IDS,
  type MainActionConfig,
  type ShortcutSlots,
  type StandardActionId,
} from '@tyco/shared'

import { slotList } from '../shortcut-slots/shortcut-slots'

function isValidActionSlot(slot: unknown): slot is MainActionConfig {
  if (!slot || typeof slot !== 'object') return false
  const item = slot as Record<string, unknown>
  if (item.type === 'standard') {
    return (
      typeof item.actionId === 'string' &&
      STANDARD_ACTION_IDS.includes(item.actionId as StandardActionId)
    )
  }
  if (item.type === 'plugin') {
    return typeof item.actionId === 'string' && item.actionId.trim().length > 0
  }
  if (item.type === 'command') {
    return (
      typeof item.commandId === 'string' && item.commandId.trim().length > 0
    )
  }
  if (item.type === 'transformation') {
    return (
      typeof item.transformationId === 'string' &&
      item.transformationId.trim().length > 0
    )
  }
  if (item.type === 'styling') {
    return (
      typeof item.stylingId === 'string' && item.stylingId.trim().length > 0
    )
  }
  if (item.type === 'translation') {
    return typeof item.language === 'string' && item.language.trim().length > 0
  }
  if (item.type === 'profileChat') {
    return (
      typeof item.profileId === 'string' && item.profileId.trim().length > 0
    )
  }
  if (item.type === 'profile') {
    return (
      typeof item.profileId === 'string' &&
      item.profileId.trim().length > 0 &&
      typeof item.action === 'string' &&
      [
        'quickAiRequest',
        'voiceQuickAiRequest',
        'screenshotQuickAiRequest',
        'voiceScreenshotQuickAiRequest',
        'chat',
      ].includes(item.action)
    )
  }
  return false
}

/** The items of the action menu grid in key order; an empty slot is `null` */
export function normalizeMainActions(
  value: unknown
): (MainActionConfig | null)[] {
  if (value === undefined) {
    return slotList(DEFAULT_ACTION_PAGES[0]?.slots ?? {})
  }
  if (!value || typeof value !== 'object') {
    return slotList({})
  }
  const filtered: ShortcutSlots<MainActionConfig> = {}
  for (const [key, slot] of Object.entries(value as Record<string, unknown>)) {
    if (
      SHORTCUT_SLOT_KEYS.includes(key as (typeof SHORTCUT_SLOT_KEYS)[number]) &&
      isValidActionSlot(slot)
    ) {
      filtered[key as (typeof SHORTCUT_SLOT_KEYS)[number]] = slot
    }
  }
  return slotList(filtered)
}

/** All configured actions are visible in the settings and action menu. */
export function isMainActionVisible(
  _action: MainActionConfig,
  _isInDevelopment?: boolean | undefined
): boolean {
  return true
}
