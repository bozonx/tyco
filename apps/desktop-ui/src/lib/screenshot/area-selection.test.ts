import { describe, expect, it } from 'vitest'

import {
  dragRect,
  fittedImageRect,
  isSelection,
  toPhysicalCrop,
} from './area-selection'

const view = { width: 960, height: 540 }
const full = { x: 0, y: 0, ...view }

describe('area selection', () => {
  it('fills the view with a capture of the same aspect ratio', () => {
    expect(fittedImageRect(view, { width: 1920, height: 1080 })).toEqual(full)
  })

  it('shows a capture of two outputs whole and centered', () => {
    expect(fittedImageRect(view, { width: 3840, height: 1080 })).toEqual({
      x: 0,
      y: 135,
      width: 960,
      height: 270,
    })
  })

  it('normalizes drags in any direction and clamps them to the image', () => {
    expect(dragRect({ x: 100, y: 80 }, { x: 20, y: 10 }, full)).toEqual({
      x: 20,
      y: 10,
      width: 80,
      height: 70,
    })
    const shown = { x: 0, y: 135, width: 960, height: 270 }
    expect(dragRect({ x: 900, y: 500 }, { x: 2000, y: -5 }, shown)).toEqual({
      x: 900,
      y: 135,
      width: 60,
      height: 270,
    })
  })

  it('treats tiny drags as clicks', () => {
    expect(isSelection({ x: 0, y: 0, width: 3, height: 50 })).toBe(false)
    expect(isSelection(null)).toBe(false)
    expect(
      toPhysicalCrop({ x: 0, y: 0, width: 50, height: 2 }, full, view)
    ).toBe(null)
  })

  it('maps view pixels to image pixels from the shown size', () => {
    const image = { width: 1920, height: 1080 }
    expect(
      toPhysicalCrop({ x: 10, y: 20, width: 100, height: 200 }, full, image)
    ).toEqual({ x: 20, y: 40, width: 200, height: 400 })
  })

  it('subtracts the bars around a fitted image', () => {
    const image = { width: 3840, height: 1080 }
    const shown = fittedImageRect(view, image)
    expect(
      toPhysicalCrop({ x: 480, y: 135, width: 100, height: 50 }, shown, image)
    ).toEqual({ x: 1920, y: 0, width: 400, height: 200 })
  })

  it('keeps the crop inside the image at fractional scales', () => {
    const image = { width: 2560, height: 1440 }
    const crop = toPhysicalCrop(
      { x: 900.4, y: 500.6, width: 59.6, height: 39.4 },
      full,
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
        { x: 0, y: 0, width: 0, height: 0 },
        view
      )
    ).toBe(null)
  })
})
