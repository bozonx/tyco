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
