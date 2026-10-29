import { describe, expect, it } from 'vitest'

import {
  findTransformation,
  moveTransformationSlot,
  placeNewTransformation,
  removeTransformationAt,
  transformationSlotList,
  updateTransformation,
  withoutEmptyTransformations,
  type TransformationLibrary,
} from './transformation-library'

const library = (): TransformationLibrary => ({
  items: [
    { id: 'a', name: 'A', rule: 'x' },
    { id: 'b', name: 'B', rule: 'y' },
  ],
  slots: { q: 'a', e: 'b' },
})

describe('transformation library', () => {
  it('lists the transformations of the menu by slot', () => {
    const slots = transformationSlotList(library())
    expect(slots[0]?.id).toBe('a')
    expect(slots[1]).toBeNull()
    expect(slots[2]?.id).toBe('b')
    expect(
      transformationSlotList(undefined).every((item) => item === null)
    ).toBe(true)
  })

  it('leaves a slot of a missing transformation empty', () => {
    expect(
      transformationSlotList({ items: [], slots: { q: 'gone' } })[0]
    ).toBeNull()
  })

  it('adds a transformation into a slot and removes it with its slot', () => {
    const added = placeNewTransformation(library(), 1, {
      id: 'c',
      name: 'C',
      rule: '',
    })
    expect(added.slots).toEqual({ q: 'a', w: 'c', e: 'b' })
    expect(findTransformation(added.items, 'c')?.name).toBe('C')

    const removed = removeTransformationAt(added, 0)
    expect(removed.slots).toEqual({ w: 'c', e: 'b' })
    expect(removed.items.map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('moves a transformation between slots without touching the library', () => {
    const moved = moveTransformationSlot(library(), 0, 3)
    expect(moved.slots).toEqual({ e: 'b', r: 'a' })
    expect(moved.items).toEqual(library().items)
  })

  it('updates a transformation', () => {
    const updated = updateTransformation(library(), 'a', { name: 'A2' })
    expect(findTransformation(updated.items, 'a')?.name).toBe('A2')
  })

  it('drops empty transformations and their slots', () => {
    const cleaned = withoutEmptyTransformations({
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
