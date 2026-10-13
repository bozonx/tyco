import type { FetchFunction } from '@bozonx/ai-kit'

/** A provider's minimum retry delay, in either HTTP-date or seconds form. */
export function retryAfterMs(value: string | null, nowMs = Date.now()): number {
  if (!value?.trim()) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const dateMs = Date.parse(value)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : 0
}

export function waitForRetry(
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(finish, Math.min(delayMs, 2_147_483_647))
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Leave retries to ai-kit, but never return a retryable refusal too early. */
export function createProviderFetch(fetch: FetchFunction): FetchFunction {
  return async (input, init) => {
    const response = await fetch(input, init)
    if (response.status === 429 || response.status === 503) {
      const signal =
        init?.signal ?? (input instanceof Request ? input.signal : undefined)
      try {
        await waitForRetry(
          retryAfterMs(response.headers.get('retry-after')),
          signal ?? undefined
        )
      } catch (error) {
        await response.body?.cancel().catch(() => undefined)
        throw error
      }
    }
    return response
  }
}
