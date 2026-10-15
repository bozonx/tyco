import { describe, expect, it } from 'vitest'

import { constrainPosition, placeAnchoredPanel } from './floating-position'

describe('floating panels', () => {
  const viewport = { width: 480, height: 600 }
  it('flips above a low anchor and clamps long menus to the viewport', () => {
    expect(
      placeAnchoredPanel(
        { left: 450, right: 475, top: 550, bottom: 580 },
        { width: 200, height: 150 },
        viewport,
        'bottom',
        'start'
      )
    ).toEqual({ x: 272, y: 394, placement: 'top' })
  })
  it('flips below an anchor when there is insufficient room above', () => {
    expect(
      placeAnchoredPanel(
        { left: 100, right: 140, top: 10, bottom: 30 },
        { width: 100, height: 50 },
        viewport,
        'top',
        'center'
      )
    ).toEqual({ x: 70, y: 36, placement: 'bottom' })
  })
  it('keeps oversized and off-screen panels anchored to the safe margin', () => {
    expect(
      constrainPosition(
        { x: -50, y: 900 },
        { width: 600, height: 800 },
        viewport
      )
    ).toEqual({ x: 8, y: 8 })
  })
})
