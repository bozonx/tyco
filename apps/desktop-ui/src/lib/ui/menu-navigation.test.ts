import { describe, expect, it } from 'vitest'

import { menuFocusIndex } from './menu-navigation'

describe('menuFocusIndex', () => {
  it('wraps and handles entry from outside the menu', () => {
    expect(menuFocusIndex('ArrowDown', 2, 3)).toBe(0)
    expect(menuFocusIndex('ArrowUp', 0, 3)).toBe(2)
    expect(menuFocusIndex('ArrowDown', -1, 3)).toBe(0)
    expect(menuFocusIndex('ArrowUp', -1, 3)).toBe(2)
  })
  it('handles boundaries, empty menus and unrelated keys', () => {
    expect(menuFocusIndex('Home', 2, 3)).toBe(0)
    expect(menuFocusIndex('End', 0, 3)).toBe(2)
    expect(menuFocusIndex('Home', 0, 0)).toBeUndefined()
    expect(menuFocusIndex('Tab', 0, 3)).toBeUndefined()
  })
})
