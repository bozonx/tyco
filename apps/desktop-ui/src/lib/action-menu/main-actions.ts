import { normalizeConfigField, type MainActionConfig } from '@tyco/shared'

import { slotList } from '../shortcut-slots/shortcut-slots'

/** The items of the action menu grid in key order; an empty slot is `null` */
export function normalizeMainActions(
  value: unknown
): (MainActionConfig | null)[] {
  return slotList(normalizeConfigField('mainActions', value))
}

/** Development actions stay saved while their UI slots are hidden. */
export function isMainActionVisible(
  action: MainActionConfig,
  isInDevelopment: boolean | undefined
): boolean {
  return (
    Boolean(isInDevelopment) ||
    (action.type !== 'command' &&
      action.type !== 'launcherPage' &&
      !(action.type === 'standard' && action.actionId === 'askInChat'))
  )
}
