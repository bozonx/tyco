import { describe, expect, it } from 'vitest'

import {
  IMAGE_VIEWER_MAX_SCALE,
  IMAGE_VIEWER_MIN_SCALE,
  createImageViewerModel,
} from './image-viewer-model'

const stage = { left: 0, top: 0, width: 1000, height: 800 }
const content = { width: 500, height: 400 }

describe('image viewer model', () => {
  it('starts centered at 1x and resets back to 1x', () => {
    const model = createImageViewerModel()
    expect(model.getState()).toEqual({ scale: 1, offsetX: 0, offsetY: 0 })

    model.zoomByWheel(-120, 0, 700, 500, stage, content)
    expect(model.getState().scale).toBeGreaterThan(1)

    expect(model.reset()).toEqual({ scale: 1, offsetX: 0, offsetY: 0 })
  })

  it('zooms in on negative wheel delta and out on positive wheel delta within limits', () => {
    const model = createImageViewerModel()

    for (let i = 0; i < 40; i++) {
      model.zoomByWheel(-200, 0, 500, 400, stage, content)
    }
    expect(model.getState().scale).toBe(IMAGE_VIEWER_MAX_SCALE)

    for (let i = 0; i < 80; i++) {
      model.zoomByWheel(200, 0, 500, 400, stage, content)
    }
    expect(model.getState().scale).toBe(IMAGE_VIEWER_MIN_SCALE)
  })

  it('keeps the point under the cursor stationary when zooming', () => {
    const model = createImageViewerModel()
    const cursorX = 650
    const cursorY = 300
    const centerX = stage.width / 2
    const centerY = stage.height / 2
    const localXBefore = cursorX - centerX
    const localYBefore = cursorY - centerY

    const next = model.zoomTo(2, cursorX, cursorY, stage, content)
    const screenXAfter = next.offsetX + next.scale * localXBefore
    const screenYAfter = next.offsetY + next.scale * localYBefore

    expect(screenXAfter).toBeCloseTo(cursorX - centerX, 5)
    expect(screenYAfter).toBeCloseTo(cursorY - centerY, 5)
  })

  it('normalizes line and page wheel delta modes', () => {
    const pixelModel = createImageViewerModel()
    const lineModel = createImageViewerModel()

    pixelModel.zoomByWheel(-16, 0, 500, 400, stage, content)
    lineModel.zoomByWheel(-1, 1, 500, 400, stage, content)

    expect(lineModel.getState().scale).toBeCloseTo(
      pixelModel.getState().scale,
      6
    )
  })

  it('pans freely and keeps a visible margin inside the stage', () => {
    const model = createImageViewerModel()
    const moved = model.panBy(100, -50, stage, content)
    expect(moved).toEqual({ scale: 1, offsetX: 100, offsetY: -50 })

    const clamped = model.panBy(5000, 5000, stage, content)
    expect(clamped.offsetX).toBeLessThan(1000)
    expect(clamped.offsetY).toBeLessThan(800)
  })
})
