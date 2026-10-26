import { describe, expect, it } from 'vitest'
import { AiError } from '@bozonx/ai-kit'
import {
  formatTranslationError,
  translationErrorKey,
} from './translation-errors'

describe('translation errors', () => {
  it('maps DeepL quota exceeded to translationErrors.quotaExceeded', () => {
    const error = new AiError(
      'invalid_request',
      'DeepL translation quota is exhausted',
      { status: 456 }
    )
    expect(translationErrorKey(error)).toBe('translationErrors.quotaExceeded')
  })

  it('maps unsupported language to translationErrors.unsupportedLanguage', () => {
    const error = new AiError('invalid_request', 'Language xx is not supported')
    expect(translationErrorKey(error)).toBe(
      'translationErrors.unsupportedLanguage'
    )
  })

  it('maps invalid credentials to translationErrors.auth', () => {
    const error = new AiError('auth', 'Invalid API key')
    expect(translationErrorKey(error)).toBe('translationErrors.auth')
  })

  it('formats translation error with translated label and detail', () => {
    const error = new AiError('auth', 'Key rejected')
    const formatted = formatTranslationError(error, (key) => `[${key}]`)
    expect(formatted).toBe('[translationErrors.auth]\nKey rejected')
  })
})
