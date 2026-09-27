import type { MenuPlacement } from './menu-item'

/** Gap from the window edge, so a menu does not stick to the border */
export const VIEWPORT_GAP = 8
/** Gap between a menu and the text line it is anchored to */
export const ANCHOR_GAP = 6

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface PlacementAnchor extends Point {
  /** Bottom of the anchored text line; used by `below` */
  bottom?: number
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max))

/** Top-left corner of a menu next to its anchor, kept inside the viewport */
export const placeMenu = (
  anchor: PlacementAnchor,
  size: Size,
  placement: MenuPlacement,
  viewport: Size
): Point => {
  const y =
    placement === 'below' ? (anchor.bottom ?? anchor.y) + ANCHOR_GAP : anchor.y

  return {
    x: clamp(
      anchor.x,
      VIEWPORT_GAP,
      viewport.width - size.width - VIEWPORT_GAP
    ),
    y: clamp(y, VIEWPORT_GAP, viewport.height - size.height - VIEWPORT_GAP),
  }
}

/**
 * Top-left corner of a submenu: to the right of its parent item, or to the left
 * when there is no room, aligned with the item's top edge
 */
export const placeSubmenu = (
  parent: Rect,
  size: Size,
  viewport: Size
): Point => {
  const right = parent.right + 2
  const x =
    right + size.width <= viewport.width - VIEWPORT_GAP
      ? right
      : parent.left - size.width - 2

  return {
    x: clamp(x, VIEWPORT_GAP, viewport.width - size.width - VIEWPORT_GAP),
    y: clamp(
      parent.top,
      VIEWPORT_GAP,
      viewport.height - size.height - VIEWPORT_GAP
    ),
  }
}
