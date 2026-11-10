export interface ImageViewerRect {
  left: number
  top: number
  width: number
  height: number
}

export interface ImageViewerSize {
  width: number
  height: number
}

export interface ImageViewerState {
  scale: number
  offsetX: number
  offsetY: number
}

export const IMAGE_VIEWER_MIN_SCALE = 0.25
export const IMAGE_VIEWER_MAX_SCALE = 10
const WHEEL_SENSITIVITY = 0.002
const MAX_WHEEL_DELTA = 240
const VISIBLE_MARGIN_PX = 48

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  const multiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1
  return clamp(deltaY * multiplier, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA)
}

function clampOffsets(
  offsetX: number,
  offsetY: number,
  scale: number,
  stageSize?: ImageViewerSize,
  contentSize?: ImageViewerSize
): { offsetX: number; offsetY: number } {
  if (
    !stageSize ||
    !contentSize ||
    stageSize.width <= 0 ||
    stageSize.height <= 0 ||
    contentSize.width <= 0 ||
    contentSize.height <= 0
  ) {
    return { offsetX, offsetY }
  }
  const scaledWidth = contentSize.width * scale
  const scaledHeight = contentSize.height * scale
  const marginX = Math.min(VISIBLE_MARGIN_PX, scaledWidth / 2)
  const marginY = Math.min(VISIBLE_MARGIN_PX, scaledHeight / 2)
  const maxX = Math.max(0, (stageSize.width + scaledWidth) / 2 - marginX)
  const maxY = Math.max(0, (stageSize.height + scaledHeight) / 2 - marginY)
  return {
    offsetX: clamp(offsetX, -maxX, maxX),
    offsetY: clamp(offsetY, -maxY, maxY),
  }
}

/** Pure zoom and pan state transitions for the fullscreen image viewer. */
export function createImageViewerModel() {
  let state: ImageViewerState = { scale: 1, offsetX: 0, offsetY: 0 }

  const getState = (): ImageViewerState => ({ ...state })

  const reset = (): ImageViewerState => {
    state = { scale: 1, offsetX: 0, offsetY: 0 }
    return getState()
  }

  const zoomTo = (
    targetScale: number,
    cursorX: number,
    cursorY: number,
    stageRect: ImageViewerRect,
    contentSize?: ImageViewerSize
  ): ImageViewerState => {
    const nextScale = clamp(
      targetScale,
      IMAGE_VIEWER_MIN_SCALE,
      IMAGE_VIEWER_MAX_SCALE
    )
    const centerX = stageRect.left + stageRect.width / 2
    const centerY = stageRect.top + stageRect.height / 2
    const cursorRelX = cursorX - centerX
    const cursorRelY = cursorY - centerY
    const ratio = nextScale / state.scale
    const rawOffsetX = cursorRelX - ratio * (cursorRelX - state.offsetX)
    const rawOffsetY = cursorRelY - ratio * (cursorRelY - state.offsetY)
    const clamped = clampOffsets(
      rawOffsetX,
      rawOffsetY,
      nextScale,
      stageRect,
      contentSize
    )
    state = {
      scale: nextScale,
      offsetX: clamped.offsetX,
      offsetY: clamped.offsetY,
    }
    return getState()
  }

  const zoomByWheel = (
    deltaY: number,
    deltaMode: number,
    cursorX: number,
    cursorY: number,
    stageRect: ImageViewerRect,
    contentSize?: ImageViewerSize
  ): ImageViewerState => {
    if (!Number.isFinite(deltaY) || deltaY === 0) return getState()
    const normalized = normalizeWheelDelta(deltaY, deltaMode)
    const factor = Math.exp(-normalized * WHEEL_SENSITIVITY)
    return zoomTo(
      state.scale * factor,
      cursorX,
      cursorY,
      stageRect,
      contentSize
    )
  }

  const panBy = (
    dx: number,
    dy: number,
    stageSize?: ImageViewerSize,
    contentSize?: ImageViewerSize
  ): ImageViewerState => {
    const clamped = clampOffsets(
      state.offsetX + dx,
      state.offsetY + dy,
      state.scale,
      stageSize,
      contentSize
    )
    state = {
      scale: state.scale,
      offsetX: clamped.offsetX,
      offsetY: clamped.offsetY,
    }
    return getState()
  }

  return { getState, reset, zoomTo, zoomByWheel, panBy }
}
