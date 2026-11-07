import type { CropRect } from '@tyco/shared'

export type ViewRect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }

/** Smallest selection side in view pixels; a shorter drag is a click. */
export const MIN_SELECTION_PX = 4

/**
 * Where the frozen image is shown: fitted into the view, centered. It fills a
 * single monitor capture exactly; a capture of several outputs (Wayland
 * portals) is shown whole, with bars around it.
 */
export function fittedImageRect(view: Size, image: Size): ViewRect {
  if (view.width <= 0 || view.height <= 0 || image.width <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const scale = Math.min(view.width / image.width, view.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return {
    x: (view.width - width) / 2,
    y: (view.height - height) / 2,
    width,
    height,
  }
}

/** Normalizes a drag between two points into a rectangle clamped to `bounds`. */
export function dragRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: ViewRect
): ViewRect {
  const clampX = (v: number) =>
    Math.min(Math.max(v, bounds.x), bounds.x + bounds.width)
  const clampY = (v: number) =>
    Math.min(Math.max(v, bounds.y), bounds.y + bounds.height)
  const x1 = clampX(Math.min(start.x, end.x))
  const y1 = clampY(Math.min(start.y, end.y))
  const x2 = clampX(Math.max(start.x, end.x))
  const y2 = clampY(Math.max(start.y, end.y))
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

export function isSelection(rect: ViewRect | null): rect is ViewRect {
  return (
    rect !== null &&
    rect.width >= MIN_SELECTION_PX &&
    rect.height >= MIN_SELECTION_PX
  )
}

/**
 * Maps a selection in view pixels to pixels of the frozen image shown at
 * `shown`. The scale comes from the shown size, not from a window scale factor,
 * so it stays right on any monitor.
 */
export function toPhysicalCrop(
  rect: ViewRect,
  shown: ViewRect,
  image: Size
): CropRect | null {
  if (!isSelection(rect) || shown.width <= 0 || shown.height <= 0) return null
  const scaleX = image.width / shown.width
  const scaleY = image.height / shown.height
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
  const x = clamp(Math.round((rect.x - shown.x) * scaleX), image.width)
  const y = clamp(Math.round((rect.y - shown.y) * scaleY), image.height)
  const right = clamp(
    Math.round((rect.x + rect.width - shown.x) * scaleX),
    image.width
  )
  const bottom = clamp(
    Math.round((rect.y + rect.height - shown.y) * scaleY),
    image.height
  )
  if (right - x < 1 || bottom - y < 1) return null
  return { x, y, width: right - x, height: bottom - y }
}
