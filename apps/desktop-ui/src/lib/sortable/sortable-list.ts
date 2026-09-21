/** Vertical extent of a list item, measured once when a drag starts. */
export interface SortableRect {
  top: number
  height: number
}

export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number
): T[] {
  const next = [...items]
  if (from === to || from < 0 || from >= next.length) return next

  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)

  return next
}

/**
 * Index the dragged item lands on: the number of other items whose midpoint is
 * above the dragged item's current midpoint.
 */
export function resolveTargetIndex(
  rects: readonly SortableRect[],
  from: number,
  offsetY: number
): number {
  const dragged = rects[from]
  if (!dragged) return from

  const center = dragged.top + dragged.height / 2 + offsetY
  let target = 0

  rects.forEach((rect, index) => {
    if (index !== from && rect.top + rect.height / 2 < center) target++
  })

  return target
}

/** Distance between neighbours, so shifted items keep the list's spacing. */
function listGap(rects: readonly SortableRect[]): number {
  if (rects.length < 2) return 0

  return Math.max(0, rects[1].top - (rects[0].top + rects[0].height))
}

/** How far a non-dragged item moves to free the slot at `to`. */
export function resolveItemShift(
  rects: readonly SortableRect[],
  from: number,
  to: number,
  index: number
): number {
  const dragged = rects[from]
  if (!dragged || index === from) return 0

  const space = dragged.height + listGap(rects)
  if (from < to && index > from && index <= to) return -space
  if (to < from && index >= to && index < from) return space

  return 0
}
