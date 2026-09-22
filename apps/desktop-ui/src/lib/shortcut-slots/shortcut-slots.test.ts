import { describe, expect, it } from 'vitest'

import {
  moveShortcutSlot,
  normalizeShortcutSlots,
  SHORTCUT_SLOT_COUNT,
} from './shortcut-slots'

describe('shortcut slots', () => {
  it('pads existing actions to the complete keyboard layout', () => {
    const slots = normalizeShortcutSlots(['first', 'second'])

    expect(slots).toHaveLength(SHORTCUT_SLOT_COUNT)
    expect(slots.slice(0, 3)).toEqual(['first', 'second', null])
  })

  it('moves an action to a free slot', () => {
    const slots = normalizeShortcutSlots(['first'])

    expect(moveShortcutSlot(slots, 0, 7)[7]).toBe('first')
    expect(moveShortcutSlot(slots, 0, 7)[0]).toBeNull()
  })

  it('swaps two occupied slots without losing an action', () => {
    const slots = normalizeShortcutSlots(['first', 'second'])

    expect(moveShortcutSlot(slots, 0, 1).slice(0, 2)).toEqual([
      'second',
      'first',
    ])
  })
})
