import { LlmError, toLlmError } from './llm-client'
import { formatLlmError } from './llm-errors'

export interface LlmRequestErrorDependencies {
  translate: (key: string) => string
  logError: (message: string, error: LlmError) => void
  notifyError: (message: string) => void
}

/** Cancelled requests are silent; other failures preserve their typed error. */
export function handleLlmRequestError(
  error: unknown,
  message: string,
  options: { signal?: AbortSignal; notifyError?: boolean },
  deps: LlmRequestErrorDependencies
): '' {
  if (options.signal?.aborted) return ''
  const llmError = error instanceof LlmError ? error : toLlmError(error)
  deps.logError(message, llmError)
  if (options.notifyError !== false)
    deps.notifyError(formatLlmError(llmError, deps.translate))
  throw llmError
}
