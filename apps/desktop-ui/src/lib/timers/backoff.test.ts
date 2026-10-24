import { describe, expect, it } from 'vitest'

import { backoffDelayMs } from './backoff'

describe('backoffDelayMs', () => {
  it('doubles from the first wait up to the cap', () => {
    const options = { firstMs: 1000, maxMs: 30_000 }
    expect(backoffDelayMs(0, options)).toBe(1000)
    expect(backoffDelayMs(1, options)).toBe(2000)
    expect(backoffDelayMs(4, options)).toBe(16_000)
    expect(backoffDelayMs(5, options)).toBe(30_000)
  })

  it('has no cap unless given one', () => {
    expect(backoffDelayMs(10, { firstMs: 1 })).toBe(1024)
  })
})
