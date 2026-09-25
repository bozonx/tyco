/** How long a text dismissed by a focus loss is offered again. */
export const DRAFT_RESTORE_MS = 10 * 60 * 1000

/**
 * Whether the quick input should open with the text it held when it was last
 * dismissed, rather than empty. Only a dismissal keeps it: the user did not
 * mean to drop the text, unlike Esc or a finished insertion
 */
export function shouldRestoreDraft(
  text: string,
  dismissedAt: number | null,
  now: number,
  maxAgeMs = DRAFT_RESTORE_MS
): boolean {
  if (dismissedAt === null || !text.trim()) return false

  return now - dismissedAt <= maxAgeMs
}
