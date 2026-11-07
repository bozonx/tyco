import { describe, expect, it } from 'vitest'

import { dragRect, isSelection, toPhysicalCrop } from './area-selection'

const view = { width: 960, height: 540 }

describe('area selection', () => {
  it('normalizes drags in any direction and clamps them to the view', () => {
    expect(dragRect({ x: 100, y: 80 }, { x: 20, y: 10 }, view)).toEqual({
      x: 20,
      y: 10,
      width: 80,
      height: 70,
    })
    expect(dragRect({ x: 900, y: 500 }, { x: 2000, y: -5 }, view)).toEqual({
      x: 900,
      y: 0,
      width: 60,
      height: 500,
    })
  })

  it('treats tiny drags as clicks', () => {
    expect(isSelection({ x: 0, y: 0, width: 3, height: 50 })).toBe(false)
    expect(isSelection(null)).toBe(false)
    expect(
      toPhysicalCrop({ x: 0, y: 0, width: 50, height: 2 }, view, view)
    ).toBe(null)
  })

  it('maps view pixels to physical pixels from the real view size', () => {
    const image = { width: 1920, height: 1080 }
    expect(
      toPhysicalCrop({ x: 10, y: 20, width: 100, height: 200 }, view, image)
    ).toEqual({ x: 20, y: 40, width: 200, height: 400 })
  })

  it('keeps the crop inside the image at fractional scales', () => {
    const image = { width: 2560, height: 1440 }
    const crop = toPhysicalCrop(
      { x: 900.4, y: 500.6, width: 59.6, height: 39.4 },
      view,
      image
    )!
    expect(crop.x + crop.width).toBeLessThanOrEqual(image.width)
    expect(crop.y + crop.height).toBeLessThanOrEqual(image.height)
    expect(crop.width).toBeGreaterThan(0)
  })

  it('rejects an empty view', () => {
    expect(
      toPhysicalCrop(
        { x: 0, y: 0, width: 10, height: 10 },
        { width: 0, height: 0 },
        view
      )
    ).toBe(null)
  })
})
