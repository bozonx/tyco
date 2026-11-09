/** The key that switches between voice input and listening: Alt+L */
export function isModeSwitchKey(
  event: Pick<
    KeyboardEvent,
    'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
  >
): boolean {
  return (
    event.code === 'KeyL' &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  )
}
