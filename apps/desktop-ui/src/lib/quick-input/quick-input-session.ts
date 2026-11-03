/**
 * Keeps the text of the quick input from being lost by accident.
 *
 * - Unfinished input survives window hiding and reactivation without expiry.
 * - Esc clears the text on purpose, but ArrowUp in the empty input still brings
 *   it back, as it brings back the last sent text
 */
export function createQuickInputSession() {
  let isSubmitted = false
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
      isSubmitted = false
    },

    /**
     * A new opening with `text` left in the input. Returns whether to keep it;
     * otherwise the input is emptied and the text stays recallable
     */
    start(text: string): boolean {
      const restore = !isSubmitted && Boolean(text.trim())
      isSubmitted = false
      if (restore) return true
      end(text)
      return false
    },

    /** The text leaves the input but stays recallable. */
    end(text: string): void {
      isSubmitted = true
      end(text)
    },

    /** The text was sent on to the next step. */
    submitted(text: string): void {
      isSubmitted = true
      remember(text)
    },

    /** Esc: the text is cleared, but stays recallable. */
    discard(text: string): void {
      remember(text)
      isSubmitted = true
    },
  }
}
