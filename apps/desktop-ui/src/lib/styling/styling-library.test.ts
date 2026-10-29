import { describe, expect, it } from 'vitest'

import {
  findStyling,
  moveStylingSlot,
  placeNewStyling,
  removeStylingAt,
  stylingSlotList,
  updateStyling,
  withoutEmptyStylings,
  type StylingLibrary,
} from './styling-library'

const library = (): StylingLibrary => ({
  items: [
    { id: 'a', name: 'A', rule: 'x' },
    { id: 'b', name: 'B', rule: 'y' },
  ],
  slots: { q: 'a', e: 'b' },
})

describe('styling library', () => {
  it('lists the styling presets of the menu by slot', () => {
    const slots = stylingSlotList(library())
    expect(slots[0]?.id).toBe('a')
    expect(slots[1]).toBeNull()
    expect(slots[2]?.id).toBe('b')
    expect(stylingSlotList(undefined).every((item) => item === null)).toBe(true)
  })

  it('leaves a slot of a missing styling preset empty', () => {
    expect(stylingSlotList({ items: [], slots: { q: 'gone' } })[0]).toBeNull()
  })

  it('adds a styling preset into a slot and removes it with its slot', () => {
    const added = placeNewStyling(library(), 1, {
      id: 'c',
      name: 'C',
      rule: '',
    })
    expect(added.slots).toEqual({ q: 'a', w: 'c', e: 'b' })
    expect(findStyling(added.items, 'c')?.name).toBe('C')

    const removed = removeStylingAt(added, 0)
    expect(removed.slots).toEqual({ w: 'c', e: 'b' })
    expect(removed.items.map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('moves a styling preset between slots without touching the library', () => {
    const moved = moveStylingSlot(library(), 0, 3)
    expect(moved.slots).toEqual({ e: 'b', r: 'a' })
    expect(moved.items).toEqual(library().items)
  })

  it('updates a styling preset', () => {
    const updated = updateStyling(library(), 'a', { name: 'A2' })
    expect(findStyling(updated.items, 'a')?.name).toBe('A2')
  })

  it('drops empty styling presets and their slots', () => {
    const cleaned = withoutEmptyStylings({
      items: [
        { id: 'a', name: '', rule: '' },
        { id: 'b', name: 'B', rule: '' },
      ],
      slots: { q: 'a', w: 'b' },
    })
    expect(cleaned.items.map((i) => i.id)).toEqual(['b'])
    expect(cleaned.slots).toEqual({ w: 'b' })
  })
})
