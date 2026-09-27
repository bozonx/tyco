import { describe, expect, it } from 'vitest'

import {
  ANCHOR_GAP,
  placeMenu,
  placeSubmenu,
  VIEWPORT_GAP,
} from './menu-placement'

const viewport = { width: 800, height: 600 }
const size = { width: 200, height: 100 }

describe('placeMenu', () => {
  it('puts a point menu at the anchor', () => {
    expect(placeMenu({ x: 100, y: 150 }, size, 'point', viewport)).toEqual({
      x: 100,
      y: 150,
    })
  })

  it('puts a below menu under the anchored line', () => {
    expect(
      placeMenu({ x: 100, y: 40, bottom: 60 }, size, 'below', viewport)
    ).toEqual({ x: 100, y: 60 + ANCHOR_GAP })
  })

  it('keeps the menu inside the viewport', () => {
    expect(placeMenu({ x: 790, y: 590 }, size, 'point', viewport)).toEqual({
      x: viewport.width - size.width - VIEWPORT_GAP,
      y: viewport.height - size.height - VIEWPORT_GAP,
    })
    expect(placeMenu({ x: -10, y: -10 }, size, 'point', viewport)).toEqual({
      x: VIEWPORT_GAP,
      y: VIEWPORT_GAP,
    })
  })
})

describe('placeSubmenu', () => {
  it('opens to the right of the parent item', () => {
    const parent = { left: 100, top: 200, right: 280, bottom: 230 }

    expect(placeSubmenu(parent, size, viewport)).toEqual({ x: 282, y: 200 })
  })

  it('opens to the left when there is no room on the right', () => {
    const parent = { left: 500, top: 200, right: 700, bottom: 230 }

    expect(placeSubmenu(parent, size, viewport)).toEqual({
      x: 500 - size.width - 2,
      y: 200,
    })
  })

  it('shifts up to stay inside the viewport', () => {
    const parent = { left: 100, top: 560, right: 280, bottom: 590 }

    expect(placeSubmenu(parent, size, viewport).y).toBe(
      viewport.height - size.height - VIEWPORT_GAP
    )
  })
})
