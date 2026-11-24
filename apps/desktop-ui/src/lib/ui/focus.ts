/** Removes focus from the currently active document element. */
export function blurActiveElement(): void {
  const activeElement = document.activeElement
  if (
    activeElement instanceof HTMLElement ||
    activeElement instanceof SVGElement
  ) {
    activeElement.blur()
  }
}

/**
 * Prevents mouse clicks from giving DOM focus to buttons or controls,
 * preserving keyboard navigation (Tab / Shift+Tab) and preventing focus ring retention.
 */
export function preventMouseFocus(event: PointerEvent): void {
  if (event.pointerType === 'mouse') {
    event.preventDefault()
  }
}

