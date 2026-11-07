import type { CropRect } from '@tyco/shared'

export type ViewRect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }

/** Smallest selection side in view pixels; a shorter drag is a click. */
export const MIN_SELECTION_PX = 4

/** Normalizes a drag between two points into a rectangle clamped to the view. */
export function dragRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  view: Size
): ViewRect {
  const clampX = (v: number) => Math.min(Math.max(v, 0), view.width)
  const clampY = (v: number) => Math.min(Math.max(v, 0), view.height)
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
 * Maps a selection in view pixels to physical pixels of the captured monitor.
 * The scale comes from the actual view size, so it stays right when the
 * window's scale factor differs from the monitor it covers.
 */
export function toPhysicalCrop(
  rect: ViewRect,
  view: Size,
  image: Size
): CropRect | null {
  if (!isSelection(rect) || view.width <= 0 || view.height <= 0) return null
  const scaleX = image.width / view.width
  const scaleY = image.height / view.height
  const x = Math.min(Math.max(Math.round(rect.x * scaleX), 0), image.width)
  const y = Math.min(Math.max(Math.round(rect.y * scaleY), 0), image.height)
  const right = Math.min(
    Math.round((rect.x + rect.width) * scaleX),
    image.width
  )
  const bottom = Math.min(
    Math.round((rect.y + rect.height) * scaleY),
    image.height
  )
  if (right - x < 1 || bottom - y < 1) return null
  return { x, y, width: right - x, height: bottom - y }
}
