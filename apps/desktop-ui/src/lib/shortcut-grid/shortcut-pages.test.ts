import { describe, expect, it } from 'vitest'

import {
  hasShortcut,
  pageCountOf,
  pageStartAtScroll,
  pageStartOf,
  shortcutTarget,
} from './shortcut-pages'

describe('shortcut pages', () => {
  it('finds the page start of an index', () => {
    expect(pageStartOf(0, 15)).toBe(0)
    expect(pageStartOf(14, 15)).toBe(0)
    expect(pageStartOf(15, 15)).toBe(15)
    expect(pageStartOf(31, 15)).toBe(30)
  })

  it('counts pages, at least one', () => {
    expect(pageCountOf(0, 15)).toBe(1)
    expect(pageCountOf(15, 15)).toBe(1)
    expect(pageCountOf(16, 15)).toBe(2)
  })

  it('maps a slot to an item of the current page', () => {
    expect(shortcutTarget(1, 15, 40)).toBe(16)
    expect(shortcutTarget(10, 30, 35)).toBeUndefined()
    expect(shortcutTarget(-1, 0, 5)).toBeUndefined()
  })

  it('marks only the items of the current page', () => {
    expect(hasShortcut(14, 0, 15)).toBe(true)
    expect(hasShortcut(15, 0, 15)).toBe(false)
    expect(hasShortcut(15, 15, 15)).toBe(true)
  })

  it('takes the nearest page at a scroll offset', () => {
    const base = { pageHeightPx: 300, count: 40, pageSize: 15 }
    expect(
      pageStartAtScroll({ ...base, scrollTop: 0, isAtBottom: false })
    ).toBe(0)
    expect(
      pageStartAtScroll({ ...base, scrollTop: 160, isAtBottom: false })
    ).toBe(15)
    expect(
      pageStartAtScroll({ ...base, scrollTop: 900, isAtBottom: false })
    ).toBe(30)
    expect(
      pageStartAtScroll({ ...base, scrollTop: 100, isAtBottom: true })
    ).toBe(30)
    expect(
      pageStartAtScroll({
        ...base,
        scrollTop: 50,
        pageHeightPx: 0,
        isAtBottom: false,
      })
    ).toBe(0)
  })
})
