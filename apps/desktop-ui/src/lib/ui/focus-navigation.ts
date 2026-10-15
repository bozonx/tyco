export function focusableElements(root: ParentNode) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]'
    )
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[inert]') &&
      element.getClientRects().length > 0
  )
}

/** Resume the document's Tab order after a panel rendered through Teleport. */
export function focusAfterTrigger(
  trigger: HTMLElement,
  panel: HTMLElement | null
) {
  const scope = trigger.closest('dialog') ?? trigger.ownerDocument
  const candidates = focusableElements(scope).filter(
    (element) => !panel?.contains(element)
  )
  const index = candidates.indexOf(trigger)
  ;(candidates[index + 1] ?? candidates[0])?.focus()
}
