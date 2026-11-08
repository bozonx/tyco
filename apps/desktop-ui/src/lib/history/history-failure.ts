import type { EditorHistoryFailure } from '@tyco/shared'

import { LlmError } from '../llm/llm-client'

/**
 * What the history keeps about an AI operation that produced nothing: whether
 * it failed, ran out of time or was cancelled, and the error the user saw
 */
export function historyFailureOf(
  error: unknown,
  message: string | undefined,
  isCancelled = false
): EditorHistoryFailure {
  if (isCancelled || (error instanceof LlmError && error.kind === 'aborted'))
    return { kind: 'cancelled' }
  const kind =
    error instanceof LlmError && error.kind === 'timeout' ? 'timeout' : 'error'
  return message?.trim() ? { kind, message } : { kind }
}
