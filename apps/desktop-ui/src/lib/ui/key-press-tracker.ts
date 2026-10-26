/**
 * Keys that went down while a view listened. A keyup without its keydown
 * belongs to whatever opened the view — Enter on a button, a global hotkey —
 * and must not act on the view.
 */
export function createKeyPressTracker() {
  const pressedCodes = new Set<string>()
  return {
    press(code: string) {
      pressedCodes.add(code)
    },
    /** Whether the key went down here; it is forgotten either way */
    release(code: string): boolean {
      return pressedCodes.delete(code)
    },
    /** Releases outside the window never arrive, e.g. after focus loss */
    clear() {
      pressedCodes.clear()
    },
  }
}
