import { normalizeConfigField, type MainActionConfig } from '@tyco/shared'

import { slotList } from '../shortcut-slots/shortcut-slots'

/** The items of the action menu grid in key order; an empty slot is `null` */
export function normalizeMainActions(
  value: unknown
): (MainActionConfig | null)[] {
  return slotList(normalizeConfigField('mainActions', value))
}
