import { shouldRestoreDraft } from './draft-restore'

/**
 * Keeps the text of the quick input from being lost by accident.
 *
 * - A focus loss (a stray click) hides the window: the text comes back on the
 *   next opening for a while, then is cleared.
 * - Esc clears the text on purpose, but ArrowUp in the empty input still brings
 *   it back, as it brings back the last sent text
 */
export function createQuickInputSession(now: () => number = Date.now) {
  let dismissedAt: number | null = null
  let recallText = ''

  const remember = (text: string): void => {
    if (text.trim()) recallText = text
  }

  const end = (text: string): void => {
    remember(text)
  }

  return {
    /** The text ArrowUp puts into the empty input. */
    get recallText(): string {
      return recallText
    },

    /** The window lost focus with this text in the input. */
    markDismissed(): void {
      dismissedAt = now()
    },

    /**
     * A new opening with `text` left in the input. Returns whether to keep it;
     * otherwise the input is emptied and the text stays recallable
     */
    start(text: string): boolean {
      const restore = shouldRestoreDraft(text, dismissedAt, now())
      dismissedAt = null
      if (restore) return true
      end(text)
      return false
    },

    /** The text leaves the input but stays recallable. */
    end(text: string): void {
      dismissedAt = null
      end(text)
    },

    /** The text was sent on to the next step. */
    submitted(text: string): void {
      remember(text)
    },

    /** Esc: the text is cleared, but stays recallable. */
    discard(text: string): void {
      remember(text)
      dismissedAt = null
    },
  }
}
