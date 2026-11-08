/**
 * Paging of a shortcut grid: the shortcut keys pick the items of the current
 * page, so a long list is walked page by page with the same keys
 */

/** The first index of the page holding `index` */
export function pageStartOf(index: number, pageSize: number): number {
  if (pageSize <= 0 || index <= 0) return 0
  return Math.floor(index / pageSize) * pageSize
}

/** How many pages `count` items take; at least one */
export function pageCountOf(count: number, pageSize: number): number {
  if (pageSize <= 0 || count <= 0) return 1
  return Math.ceil(count / pageSize)
}

/** The item index a shortcut slot picks on the page starting at `pageStart` */
export function shortcutTarget(
  slot: number,
  pageStart: number,
  count: number
): number | undefined {
  if (slot < 0) return undefined
  const index = pageStart + slot
  return index < count ? index : undefined
}

/** Whether `index` carries a shortcut key on the page starting at `pageStart` */
export function hasShortcut(
  index: number,
  pageStart: number,
  pageSize: number
): boolean {
  return index >= pageStart && index < pageStart + pageSize
}

/**
 * The page start shown at a scroll offset: the page whose top is nearest to
 * `scrollTop`, or the last page when scrolled to the bottom
 */
export function pageStartAtScroll(options: {
  scrollTop: number
  pageHeightPx: number
  isAtBottom: boolean
  count: number
  pageSize: number
}): number {
  const { scrollTop, pageHeightPx, isAtBottom, count, pageSize } = options
  const lastPageStart = pageStartOf(Math.max(0, count - 1), pageSize)
  if (isAtBottom) return lastPageStart
  if (pageHeightPx <= 0) return 0
  const page = Math.round(scrollTop / pageHeightPx)
  return Math.min(lastPageStart, Math.max(0, page * pageSize))
}
