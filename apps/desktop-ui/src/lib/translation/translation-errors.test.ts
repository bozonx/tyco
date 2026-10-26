import { describe, expect, it } from 'vitest'
import { AiError } from '@bozonx/ai-kit'
import { LlmError } from '../llm/llm-client'
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

  it('explains an LLM translator failure like any other LLM task', () => {
    expect(
      translationErrorKey(
        new LlmError('no_model', 'No language model is configured')
      )
    ).toBe('llmErrors.noModel')
    expect(
      translationErrorKey(new LlmError('timeout', 'The request timed out'))
    ).toBe('llmErrors.timeout')
  })

  it('does not take a token or context limit for a quota or a language', () => {
    expect(
      translationErrorKey(
        new AiError(
          'context_length',
          'The translation instructions exceed the language model context'
        )
      )
    ).toBe('llmErrors.contextLength')
    expect(
      translationErrorKey(
        new AiError('invalid_request', 'Request size limit reached')
      )
    ).toBe('translationErrors.invalidRequest')
  })

  it('names a language the provider refuses', () => {
    expect(
      translationErrorKey(
        new AiError(
          'invalid_request',
          'The translation provider does not support the selected language'
        )
      )
    ).toBe('translationErrors.unsupportedLanguage')
  })
})
