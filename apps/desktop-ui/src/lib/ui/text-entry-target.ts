/** Input types that take no typed text: their keys stay shortcuts */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'radio',
  'range',
  'reset',
  'submit',
])

const TEXT_ENTRY_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/**
 * Whether a key event aimed at `target` types into a field: Space and Enter
 * there belong to the text, not to a shortcut of the view around it.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.closest !== 'function') return false
  if (element.isContentEditable) return true
  const field = element.closest(TEXT_ENTRY_SELECTOR)
  if (!field) return false
  if (field.tagName === 'INPUT')
    return !NON_TEXT_INPUT_TYPES.has((field as HTMLInputElement).type)
  return true
}
