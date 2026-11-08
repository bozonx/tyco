import { describe, expect, it } from 'vitest'

import {
  hasShortcut,
  maxWindowStart,
  rowStartOf,
  shiftWindow,
  shortcutTarget,
  windowStartAtScroll,
  windowStartFor,
} from './shortcut-pages'

const grid = { columns: 5, size: 15, count: 17 }

describe('shortcut window', () => {
  it('finds the row start of an index', () => {
    expect(rowStartOf(0, 5)).toBe(0)
    expect(rowStartOf(7, 5)).toBe(5)
  })

  it('ends the latest window at the last row', () => {
    expect(maxWindowStart(grid)).toBe(5)
    expect(maxWindowStart({ ...grid, count: 15 })).toBe(0)
    expect(maxWindowStart({ ...grid, count: 40 })).toBe(25)
  })

  it('starts the window at the first visible row', () => {
    expect(windowStartAtScroll(0, 100, grid)).toBe(0)
    expect(windowStartAtScroll(60, 100, grid)).toBe(5)
    expect(windowStartAtScroll(900, 100, grid)).toBe(5)
    expect(windowStartAtScroll(50, 0, grid)).toBe(0)
  })

  it('shifts by whole windows within the grid', () => {
    const long = { ...grid, count: 40 }
    expect(shiftWindow(0, 1, long)).toBe(15)
    expect(shiftWindow(15, 1, long)).toBe(25)
    expect(shiftWindow(5, -1, long)).toBe(0)
  })

  it('moves the window just enough to keep an index inside', () => {
    const long = { ...grid, count: 40 }
    expect(windowStartFor(3, 0, long)).toBe(0)
    expect(windowStartFor(16, 0, long)).toBe(5)
    expect(windowStartFor(7, 15, long)).toBe(5)
  })

  it('maps a slot to an item of the window', () => {
    expect(shortcutTarget(0, 5, 17)).toBe(5)
    expect(shortcutTarget(12, 5, 17)).toBeUndefined()
    expect(shortcutTarget(-1, 0, 5)).toBeUndefined()
    expect(hasShortcut(5, 5, 15)).toBe(true)
    expect(hasShortcut(4, 5, 15)).toBe(false)
  })
})
