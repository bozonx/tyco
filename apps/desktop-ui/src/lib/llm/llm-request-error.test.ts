import { describe, expect, it, vi } from 'vitest'
import { LlmError } from './llm-client'
import { handleLlmRequestError } from './llm-request-error'

function setup() {
  return {
    translate: (key: string) => key,
    logError: vi.fn(),
    notifyError: vi.fn(),
  }
}

describe('LLM request errors', () => {
  it('keeps cancellation silent', () => {
    const deps = setup()
    const signal = AbortSignal.abort()
    expect(
      handleLlmRequestError(
        new Error('failed'),
        'Request failed',
        { signal },
        deps
      )
    ).toBe('')
    expect(deps.logError).not.toHaveBeenCalled()
    expect(deps.notifyError).not.toHaveBeenCalled()
  })
  it('preserves typed failures and formats their notification', () => {
    const deps = setup()
    const error = new LlmError('unknown', 'failure')
    expect(() =>
      handleLlmRequestError(error, 'Request failed', {}, deps)
    ).toThrow(error)
    expect(deps.logError).toHaveBeenCalledWith('Request failed', error)
    expect(deps.notifyError).toHaveBeenCalledOnce()
  })
  it('normalizes untyped failures and respects disabled notifications', () => {
    const deps = setup()
    expect(() =>
      handleLlmRequestError(
        new Error('failure'),
        'Translation failed',
        { notifyError: false },
        deps
      )
    ).toThrow(LlmError)
    expect(deps.logError).toHaveBeenCalledWith(
      'Translation failed',
      expect.any(LlmError)
    )
    expect(deps.notifyError).not.toHaveBeenCalled()
  })
})
