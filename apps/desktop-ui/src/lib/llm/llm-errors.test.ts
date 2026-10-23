import { describe, expect, it } from 'vitest'

import { LlmError, type LlmErrorKind } from './llm-client'
import { describeError, formatLlmError, llmErrorKey } from './llm-errors'

describe('error descriptions', () => {
  it.each<[LlmErrorKind, string]>([
    ['output_truncated', 'llmErrors.outputTruncated'],
    ['image_unsupported', 'llmErrors.imageUnsupported'],
    ['tools_unsupported', 'llmErrors.toolsUnsupported'],
    ['step_limit', 'llmErrors.stepLimit'],
    ['auth', 'llmErrors.auth'],
    ['rate_limit', 'llmErrors.rateLimit'],
    ['provider_unavailable', 'llmErrors.unavailable'],
    ['stream_interrupted', 'llmErrors.unavailable'],
    ['timeout', 'llmErrors.timeout'],
    ['context_length', 'llmErrors.contextLength'],
    ['content_filter', 'llmErrors.contentFilter'],
    ['no_model', 'llmErrors.noModel'],
    ['config', 'llmErrors.invalidRequest'],
    ['invalid_request', 'llmErrors.invalidRequest'],
    ['unknown', 'llmErrors.unknown'],
  ])('maps %s to %s', (kind, key) => {
    expect(llmErrorKey(kind)).toBe(key)
  })
  it('formats provider errors with a localized summary and bounded detail', () => {
    const error = new LlmError('auth', 'x'.repeat(600))
    expect(describeError(error, (key) => key)).toBe(
      formatLlmError(error, (key) => key)
    )
    expect(describeError(error, (key) => key)).toBe(
      `llmErrors.auth\n${'x'.repeat(500)}…`
    )
  })
  it('keeps short details whole and omits blank ones', () => {
    expect(
      formatLlmError(new LlmError('timeout', ' Slow '), (key) => key)
    ).toBe('llmErrors.timeout\nSlow')
    expect(formatLlmError(new LlmError('timeout', '  '), (key) => key)).toBe(
      'llmErrors.timeout'
    )
  })
  it('preserves ordinary errors and unknown failures', () => {
    expect(describeError(new Error('Unavailable'), (key) => key)).toBe(
      'Unavailable'
    )
    expect(describeError('Failed', (key) => key)).toBe('Failed')
  })
})
