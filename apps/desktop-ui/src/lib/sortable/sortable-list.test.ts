import { describe, expect, it } from 'vitest'

import {
  moveItem,
  resolveItemShift,
  resolveTargetIndex,
  type SortableRect,
} from './sortable-list'

// Three items with different heights and an 8px gap.
const rects: SortableRect[] = [
  { top: 0, height: 40 },
  { top: 48, height: 80 },
  { top: 136, height: 40 },
]

describe('moveItem', () => {
  it('moves an item down and up', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('returns an equal copy for no-op moves', () => {
    const items = ['a', 'b']
    const result = moveItem(items, 1, 1)

    expect(result).toEqual(items)
    expect(result).not.toBe(items)
    expect(moveItem(items, 5, 0)).toEqual(items)
  })

  it('clamps the target index', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 10)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, -3)).toEqual(['c', 'a', 'b'])
  })
})

describe('resolveTargetIndex', () => {
  it('keeps the index until the midpoint of a neighbour is crossed', () => {
    expect(resolveTargetIndex(rects, 0, 0)).toBe(0)
    // Dragged center 20 + 67 = 87 < neighbour midpoint 88.
    expect(resolveTargetIndex(rects, 0, 67)).toBe(0)
    expect(resolveTargetIndex(rects, 0, 69)).toBe(1)
    expect(resolveTargetIndex(rects, 0, 200)).toBe(2)
  })

  it('moves up past neighbours', () => {
    // Dragged center 156; item 1 midpoint 88, item 0 midpoint 20.
    expect(resolveTargetIndex(rects, 2, -60)).toBe(2)
    expect(resolveTargetIndex(rects, 2, -70)).toBe(1)
    expect(resolveTargetIndex(rects, 2, -500)).toBe(0)
  })

  it('returns the source index for an unknown item', () => {
    expect(resolveTargetIndex(rects, 7, 100)).toBe(7)
  })
})

describe('resolveItemShift', () => {
  it('shifts items between source and target up when dragging down', () => {
    expect(resolveItemShift(rects, 0, 2, 1)).toBe(-48)
    expect(resolveItemShift(rects, 0, 2, 2)).toBe(-48)
    expect(resolveItemShift(rects, 0, 1, 2)).toBe(0)
  })

  it('shifts items between target and source down when dragging up', () => {
    expect(resolveItemShift(rects, 2, 0, 0)).toBe(48)
    expect(resolveItemShift(rects, 2, 0, 1)).toBe(48)
    expect(resolveItemShift(rects, 1, 1, 0)).toBe(0)
  })

  it('never shifts the dragged item itself', () => {
    expect(resolveItemShift(rects, 1, 2, 1)).toBe(0)
  })
})
