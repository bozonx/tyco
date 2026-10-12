import { describe, expect, it } from 'vitest'

import { LlmError } from './llm-client'
import { describeError, formatLlmError } from './llm-errors'

describe('error descriptions', () => {
  it('formats provider errors with a localized summary and bounded detail', () => {
    const error = new LlmError('auth', 'x'.repeat(600))
    expect(describeError(error, (key) => key)).toBe(
      formatLlmError(error, (key) => key)
    )
    expect(describeError(error, (key) => key)).toBe(
      `llmErrors.auth\n${'x'.repeat(500)}…`
    )
  })
  it('preserves ordinary errors and unknown failures', () => {
    expect(describeError(new Error('Unavailable'), (key) => key)).toBe(
      'Unavailable'
    )
    expect(describeError('Failed', (key) => key)).toBe('Failed')
  })
})
