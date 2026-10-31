import { AiError } from '@bozonx/ai-kit'
import { withErrorDetail } from '../errors/error-detail'
import { LlmError } from '../llm/llm-client'
import { llmErrorKey } from '../llm/llm-errors'

/** DeepL answers this when the character quota of the plan is used up */
const QUOTA_EXCEEDED_STATUS = 456
const QUOTA_PATTERN = /\bquota\b|character limit|subscription/i
const UNSUPPORTED_LANGUAGE_PATTERN =
  /(?:unsupported|not supported|does not support).*\blanguage\b|\blanguage\b.*(?:unsupported|not supported)/i

/**
 * A failed translation; keeps the provider's own error, so the message can say
 * what the translator, not just any LLM, ran into
 */
export class TranslationError extends Error {
  constructor(readonly failure: unknown) {
    super(failure instanceof Error ? failure.message : String(failure), {
      cause: failure,
    })
    this.name = 'TranslationError'
  }
}

/** The chosen provider cannot translate from or into the picked language */
export class UnsupportedTranslationLanguageError extends AiError {
  constructor(provider: string) {
    super(
      'invalid_request',
      'The translation provider does not support the selected language',
      { provider }
    )
    this.name = 'UnsupportedTranslationLanguageError'
  }
}

export function translationErrorKey(error: unknown): string {
  if (error instanceof TranslationError)
    return translationErrorKey(error.failure)
  // The LLM translator fails like any other LLM task, and says why the same way
  if (error instanceof LlmError) return llmErrorKey(error.kind)
  if (error instanceof UnsupportedTranslationLanguageError)
    return 'translationErrors.unsupportedLanguage'
  if (!(error instanceof AiError)) return 'translationErrors.unknown'

  switch (error.kind) {
    case 'auth':
      return 'translationErrors.auth'
    case 'rate_limit':
      // a quota running out is told apart below; 429 alone is a burst limit
      if (
        error.status === QUOTA_EXCEEDED_STATUS ||
        QUOTA_PATTERN.test(error.message)
      )
        return 'translationErrors.quotaExceeded'
      return llmErrorKey(error.kind)
    case 'provider_unavailable':
    case 'stream_interrupted':
    case 'timeout':
      return 'translationErrors.unavailable'
    case 'context_length':
    case 'content_filter':
      return llmErrorKey(error.kind)
    default:
      break
  }
  if (
    error.status === QUOTA_EXCEEDED_STATUS ||
    QUOTA_PATTERN.test(error.message)
  )
    return 'translationErrors.quotaExceeded'
  if (UNSUPPORTED_LANGUAGE_PATTERN.test(error.message))
    return 'translationErrors.unsupportedLanguage'
  if (error.kind === 'invalid_request')
    return 'translationErrors.invalidRequest'
  return 'translationErrors.unknown'
}

export function formatTranslationError(
  error: unknown,
  translate: (key: string) => string
): string {
  const key = translationErrorKey(error)
  const failure = error instanceof TranslationError ? error.failure : error
  const detail = failure instanceof Error ? failure.message : String(failure)
  return withErrorDetail(translate(key), detail)
}
