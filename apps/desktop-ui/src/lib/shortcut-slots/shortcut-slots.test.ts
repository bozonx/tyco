import { describe, expect, it } from 'vitest'

import {
  moveShortcutSlot,
  SHORTCUT_SLOT_COUNT,
  slotList,
  slotsFromList,
} from './shortcut-slots'

describe('shortcut slots', () => {
  it('lists a grid in key order with empty slots as null', () => {
    const slots = slotList({ q: 'first', e: 'third' })

    expect(slots).toHaveLength(SHORTCUT_SLOT_COUNT)
    expect(slots.slice(0, 4)).toEqual(['first', null, 'third', null])
    expect(slotList(undefined)).toEqual(Array(SHORTCUT_SLOT_COUNT).fill(null))
  })

  it('stores only the filled slots by key', () => {
    expect(slotsFromList(['first', null, 'third'])).toEqual({
      q: 'first',
      e: 'third',
    })
    expect(slotList(slotsFromList(['a', null, 'b']))).toEqual(
      slotList({ q: 'a', e: 'b' })
    )
  })

  it('moves an action to a free slot', () => {
    const slots = slotList({ q: 'first' })

    expect(moveShortcutSlot(slots, 0, 7)[7]).toBe('first')
    expect(moveShortcutSlot(slots, 0, 7)[0]).toBeNull()
  })

  it.each([
    [-1, 1],
    [0, -1],
    [15, 0],
    [0, 15],
    [0.5, 1],
    [0, Number.NaN],
  ])('ignores invalid indices %s and %s', (from, to) => {
    const slots = slotList({ q: 'first', w: 'second' })
    expect(moveShortcutSlot(slots, from, to)).toEqual(slots)
  })

  it('swaps two occupied slots without losing an action', () => {
    const slots = slotList({ q: 'first', w: 'second' })

    expect(moveShortcutSlot(slots, 0, 1).slice(0, 2)).toEqual([
      'second',
      'first',
    ])
  })
})
