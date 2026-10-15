export interface FloatingSize {
  width: number
  height: number
}
export interface FloatingRect {
  left: number
  top: number
  right: number
  bottom: number
}

export function constrainPosition(
  point: { x: number; y: number },
  size: FloatingSize,
  viewport: FloatingSize,
  margin = 8
) {
  return {
    x: Math.max(
      margin,
      Math.min(point.x, viewport.width - size.width - margin)
    ),
    y: Math.max(
      margin,
      Math.min(point.y, viewport.height - size.height - margin)
    ),
  }
}

/** Flip an anchored panel when necessary, then keep it within the viewport. */
export function placeAnchoredPanel(
  anchor: FloatingRect,
  size: FloatingSize,
  viewport: FloatingSize,
  placement: 'top' | 'bottom',
  align: 'start' | 'center' | 'end',
  gap = 6
) {
  const above = anchor.top
  const below = viewport.height - anchor.bottom
  const effectivePlacement =
    placement === 'top' && above < size.height + gap && below > above
      ? 'bottom'
      : placement === 'bottom' && below < size.height + gap && above > below
        ? 'top'
        : placement
  const x =
    align === 'end'
      ? anchor.right - size.width
      : align === 'center'
        ? (anchor.left + anchor.right - size.width) / 2
        : anchor.left
  const y =
    effectivePlacement === 'top'
      ? anchor.top - size.height - gap
      : anchor.bottom + gap
  return {
    ...constrainPosition({ x, y }, size, viewport),
    placement: effectivePlacement,
  }
}
