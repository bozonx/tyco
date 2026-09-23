import type { LlmError, LlmErrorKind } from './llm-client'

/** The i18n key that tells the user what went wrong and what to do about it */
export function llmErrorKey(kind: LlmErrorKind): string {
  switch (kind) {
    case 'auth':
      return 'llmErrors.auth'
    case 'rate_limit':
      return 'llmErrors.rateLimit'
    case 'provider_unavailable':
    case 'stream_interrupted':
      return 'llmErrors.unavailable'
    case 'timeout':
      return 'llmErrors.timeout'
    case 'context_length':
      return 'llmErrors.contextLength'
    case 'content_filter':
      return 'llmErrors.contentFilter'
    case 'no_model':
      return 'llmErrors.noModel'
    case 'config':
    case 'invalid_request':
      return 'llmErrors.invalidRequest'
    default:
      return 'llmErrors.unknown'
  }
}

export function formatLlmError(
  error: LlmError,
  translate: (key: string) => string
): string {
  const summary = translate(llmErrorKey(error.kind))
  const rawDetail = error.message.trim()
  const detail =
    rawDetail.length > 500 ? `${rawDetail.slice(0, 500).trimEnd()}…` : rawDetail

  return detail ? `${summary}\n${detail}` : summary
}
