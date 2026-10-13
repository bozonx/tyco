import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderFetch, retryAfterMs } from './provider-fetch'

afterEach(() => vi.useRealTimers())

describe('provider retry delays', () => {
  it('accepts seconds and HTTP dates and ignores invalid or expired values', () => {
    expect(retryAfterMs('2')).toBe(2000)
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:10 GMT', 1000)).toBe(9000)
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:00 GMT', 1000)).toBe(0)
    expect(retryAfterMs('invalid')).toBe(0)
  })

  it('holds a retryable refusal until the provider permits another attempt', async () => {
    vi.useFakeTimers()
    const response = new Response(null, {
      status: 429,
      headers: { 'retry-after': '2' },
    })
    const fetch = createProviderFetch(vi.fn().mockResolvedValue(response))
    let settled = false
    const pending = fetch('https://api.example').then((result) => {
      settled = true
      return result
    })
    await vi.advanceTimersByTimeAsync(1999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe(response)
  })

  it('cancels a retry wait and releases the response body', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), {
      status: 503,
      headers: { 'retry-after': '3600' },
    })
    const fetch = createProviderFetch(vi.fn().mockResolvedValue(response))
    const pending = fetch('https://api.example', { signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('Cancelled')
    await Promise.resolve()
    controller.abort(new Error('Cancelled'))
    await rejected
    expect(cancel).toHaveBeenCalledOnce()
  })
})
