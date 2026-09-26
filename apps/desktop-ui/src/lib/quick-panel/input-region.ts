/** Rectangle in CSS pixels from the top left corner of the window. */
export interface InputRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

/** Room around the input left clickable: shadows, focus ring, rounding. */
export const INPUT_REGION_MARGIN = 8

/** Smallest rectangle containing all of `rects`, or null when there are none. */
export function unionRect(rects: readonly InputRect[]): InputRect | null {
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The part of the window that takes clicks while it shows only the input: the
 * input grown by `margin` and kept inside the window. Null means the whole
 * window takes clicks.
 */
export function inputRegion(
  content: InputRect | null,
  viewport: ViewportSize,
  margin = INPUT_REGION_MARGIN
): InputRect | null {
  if (!content || content.width <= 0 || content.height <= 0) return null
  const left = Math.max(0, Math.floor(content.x - margin))
  const top = Math.max(0, Math.floor(content.y - margin))
  const right = Math.min(
    viewport.width,
    Math.ceil(content.x + content.width + margin)
  )
  const bottom = Math.min(
    viewport.height,
    Math.ceil(content.y + content.height + margin)
  )
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function sameRegion(a: InputRect | null, b: InputRect | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  )
}

export interface InputRegionSyncDeps {
  apply: (region: InputRect | null) => Promise<void>
}

/**
 * Sends the input region to the window system one request at a time. Only the
 * latest region matters: the ones requested while a request is in flight
 * collapse into it, and a region equal to the applied one is skipped.
 */
export function createInputRegionSync(deps: InputRegionSyncDeps) {
  // undefined: nothing is known to be applied
  let applied: InputRect | null | undefined
  let wanted: InputRect | null = null
  let running = false
  let disposed = false
  // bumped by invalidate: a request in flight across it may land either side
  let epoch = 0

  const flush = async () => {
    running = true
    try {
      while (
        !disposed &&
        (applied === undefined || !sameRegion(applied, wanted))
      ) {
        const region = wanted
        const requestEpoch = epoch
        try {
          await deps.apply(region)
          applied = requestEpoch === epoch ? region : undefined
        } catch {
          // the next update retries
          applied = undefined
          return
        }
      }
    } finally {
      running = false
    }
  }

  const update = (region: InputRect | null): Promise<void> => {
    wanted = region
    if (running || disposed) return Promise.resolve()
    return flush()
  }

  /** The window system reset the region by itself, e.g. on a new activation. */
  const invalidate = () => {
    epoch += 1
    applied = undefined
  }

  const dispose = () => {
    disposed = true
  }

  return { update, invalidate, dispose }
}
