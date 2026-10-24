import { errorMessage } from '@tyco/shared/value-guards'

import { DESKTOP_ERROR_KEYS, isDesktopError } from '../desktop/ipc-error'
import { LlmError } from '../llm/llm-client'
import { formatLlmError } from '../llm/llm-errors'
import { withErrorDetail } from './error-detail'

/**
 * The text that tells the user what failed: a localized summary for provider
 * and desktop errors, with their own message as the detail; the message of any
 * other error as it is
 */
export function describeError(
  error: unknown,
  translate: (key: string) => string
): string {
  if (error instanceof LlmError) return formatLlmError(error, translate)
  if (isDesktopError(error))
    return withErrorDetail(
      translate(DESKTOP_ERROR_KEYS[error.code]),
      error.message
    )
  return errorMessage(error)
}
