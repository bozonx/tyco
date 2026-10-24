import { withErrorDetail } from '../errors/error-detail'
import type { LlmError, LlmErrorKind } from './llm-client'

/** The i18n key that tells the user what went wrong and what to do about it */
export function llmErrorKey(kind: LlmErrorKind): string {
  switch (kind) {
    case 'output_truncated':
      return 'llmErrors.outputTruncated'
    case 'image_unsupported':
      return 'llmErrors.imageUnsupported'
    case 'tools_unsupported':
      return 'llmErrors.toolsUnsupported'
    case 'step_limit':
      return 'llmErrors.stepLimit'
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
  return withErrorDetail(translate(llmErrorKey(error.kind)), error.message)
}
