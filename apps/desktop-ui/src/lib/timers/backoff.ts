/**
 * The wait before retry number `attempt`, counted from 0: `firstMs`, then twice
 * as long each time, never more than `maxMs`
 */
export function backoffDelayMs(
  attempt: number,
  { firstMs, maxMs = Infinity }: { firstMs: number; maxMs?: number }
): number {
  return Math.min(firstMs * 2 ** attempt, maxMs)
}
