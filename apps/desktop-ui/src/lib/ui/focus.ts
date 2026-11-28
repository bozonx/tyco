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
 * preserving keyboard navigation (Tab / Shift+Tab) and preventing focus ring
 * retention.
 */
export function preventMouseFocus(event: PointerEvent): void {
  if (event.pointerType === 'mouse') {
    event.preventDefault()
  }
}

const BUTTON_SELECTOR =
  'button, input[type="button"], input[type="submit"], input[type="reset"], summary, [role="button"]'

/** Applies mouse focus handling to buttons, including teleports. */
export function installButtonMouseFocusPolicy(): void {
  document.addEventListener(
    'mousedown',
    (event) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return
      const button = event.target.closest(BUTTON_SELECTOR)
      if (button) {
        event.preventDefault()
      }
    },
    { capture: true }
  )
}
