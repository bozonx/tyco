export interface RectBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MarqueeRect extends RectBounds {
  width: number
  height: number
}

export type MarqueeSelectionMode = 'replace' | 'union' | 'toggle'

export const MARQUEE_DRAG_THRESHOLD_PX = 4

/** Computes normalized rectangle coordinates from start and current points. */
export function computeMarqueeRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): MarqueeRect {
  const left = Math.min(startX, currentX)
  const top = Math.min(startY, currentY)
  const right = Math.max(startX, currentX)
  const bottom = Math.max(startY, currentY)
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/** Checks whether two 2D axis-aligned bounding boxes intersect. */
export function rectsIntersect(a: RectBounds, b: RectBounds): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  )
}

/**
 * Determines selection mode based on modifier keys (matching standard file
 * managers).
 */
export function getMarqueeMode(modifiers: {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): MarqueeSelectionMode {
  if (modifiers.ctrlKey || modifiers.metaKey) {
    return 'toggle'
  }
  if (modifiers.shiftKey) {
    return 'union'
  }
  return 'replace'
}

/**
 * Computes updated selection IDs based on initial selection before drag
 * started, the IDs currently intersecting the marquee rectangle, and selection
 * mode.
 *
 * If `allTurnIds` is provided, the returned IDs follow their original order in
 * the transcript.
 */
export function computeMarqueeSelection(
  baseSelectedIds: readonly string[],
  intersectedIds: readonly string[],
  mode: MarqueeSelectionMode,
  allTurnIds?: readonly string[]
): string[] {
  let resultSet: Set<string>

  if (mode === 'replace') {
    resultSet = new Set(intersectedIds)
  } else if (mode === 'union') {
    resultSet = new Set([...baseSelectedIds, ...intersectedIds])
  } else {
    // toggle / invert mode
    const baseSet = new Set(baseSelectedIds)
    const intersectedSet = new Set(intersectedIds)
    resultSet = new Set<string>()

    for (const id of baseSelectedIds) {
      if (!intersectedSet.has(id)) {
        resultSet.add(id)
      }
    }
    for (const id of intersectedIds) {
      if (!baseSet.has(id)) {
        resultSet.add(id)
      }
    }
  }

  if (allTurnIds && allTurnIds.length > 0) {
    return allTurnIds.filter((id) => resultSet.has(id))
  }

  return Array.from(resultSet)
}

/**
 * Checks whether an event target should prevent marquee selection from
 * starting, allowing native text selection inside bubbles or clicks on
 * interactive controls.
 */
export function isMarqueeIgnoredTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false
  return Boolean(
    target.closest(
      '.dialog-turn, button, a, input, textarea, select, [role="button"], [role="checkbox"], .dialog-feed-latest'
    )
  )
}
