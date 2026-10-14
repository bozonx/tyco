/** Resolve focus movement for a composite menu, excluding disabled items. */
export function menuFocusIndex(
  key: string,
  current: number,
  count: number
): number | undefined {
  if (count === 0) return undefined
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return undefined
  if (current < 0) return key === 'ArrowDown' ? 0 : count - 1
  return (current + (key === 'ArrowDown' ? 1 : -1) + count) % count
}

export function menuButtons(
  container: HTMLElement | null | undefined
): HTMLButtonElement[] {
  return [
    ...(container?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)'
    ) ?? []),
  ]
}

export function focusMenuItem(
  container: HTMLElement | null | undefined,
  key: string
): boolean {
  const items = menuButtons(container)
  const index = menuFocusIndex(
    key,
    items.indexOf(document.activeElement as HTMLButtonElement),
    items.length
  )
  if (index === undefined) return false
  items[index].focus()
  return true
}
