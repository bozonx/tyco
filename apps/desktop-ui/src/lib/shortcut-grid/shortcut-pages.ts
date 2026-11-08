/**
 * The shortcut window of a grid: the shortcut keys pick the items starting at
 * the first visible row, so a scrolled list is picked with the same keys
 */

export interface GridWindow {
  /** Items per row */
  columns: number
  /** Items carrying a shortcut key */
  size: number
  /** Items in the grid */
  count: number
}

/** The first index of the row holding `index` */
export function rowStartOf(index: number, columns: number): number {
  if (columns <= 0 || index <= 0) return 0
  return Math.floor(index / columns) * columns
}

/** The latest window start: the one whose window ends at the last item */
export function maxWindowStart({ columns, size, count }: GridWindow): number {
  if (count <= size) return 0
  return rowStartOf(count - 1, columns) - (size - columns)
}

function clampStart(start: number, grid: GridWindow): number {
  return Math.min(maxWindowStart(grid), Math.max(0, start))
}

/** The window start after moving it by whole windows */
export function shiftWindow(
  start: number,
  windows: number,
  grid: GridWindow
): number {
  return clampStart(start + windows * grid.size, grid)
}

/** The nearest window start that keeps `index` inside the window */
export function windowStartFor(
  index: number,
  start: number,
  grid: GridWindow
): number {
  const row = rowStartOf(index, grid.columns)
  if (index < start) return clampStart(row, grid)
  if (index >= start + grid.size)
    return clampStart(row - (grid.size - grid.columns), grid)
  return start
}

/** The window start at a scroll offset: the row nearest to the top */
export function windowStartAtScroll(
  scrollTop: number,
  rowHeightPx: number,
  grid: GridWindow
): number {
  if (rowHeightPx <= 0) return 0
  return clampStart(Math.round(scrollTop / rowHeightPx) * grid.columns, grid)
}

/** The item index a shortcut slot picks in the window starting at `start` */
export function shortcutTarget(
  slot: number,
  start: number,
  count: number
): number | undefined {
  if (slot < 0) return undefined
  const index = start + slot
  return index < count ? index : undefined
}

/** Whether `index` carries a shortcut key in the window starting at `start` */
export function hasShortcut(
  index: number,
  start: number,
  size: number
): boolean {
  return index >= start && index < start + size
}
