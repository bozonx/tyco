import { isAiError, AiError } from '@bozonx/ai-kit'
import { withErrorDetail } from '../errors/error-detail'

export function translationErrorKey(error: unknown): string {
  if (isAiError(error) || error instanceof AiError) {
    if (error.kind === 'auth') return 'translationErrors.auth'
    if (error.kind === 'rate_limit' || error.status === 456) {
      return 'translationErrors.quotaExceeded'
    }
    const msg = error.message.toLowerCase()
    if (
      msg.includes('quota') ||
      msg.includes('limit') ||
      msg.includes('subscription')
    ) {
      return 'translationErrors.quotaExceeded'
    }
    if (
      msg.includes('unsupported') ||
      msg.includes('not supported') ||
      msg.includes('language')
    ) {
      return 'translationErrors.unsupportedLanguage'
    }
    if (error.kind === 'provider_unavailable' || error.kind === 'timeout') {
      return 'translationErrors.unavailable'
    }
    if (error.kind === 'invalid_request') {
      return 'translationErrors.invalidRequest'
    }
  }
  return 'translationErrors.unknown'
}

export function formatTranslationError(
  error: unknown,
  translate: (key: string) => string
): string {
  const key = translationErrorKey(error)
  const detail = error instanceof Error ? error.message : String(error)
  return withErrorDetail(translate(key), detail)
}
