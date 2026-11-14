import type { OperationResult } from '../operations/operation-types'

/** The text of a tool result: the translated key, then the plain detail */
export function toolResultMessage(
  result: Pick<OperationResult, 'messageKey' | 'message'>,
  t: (key: string) => string
): string {
  const key = result.messageKey ? t(result.messageKey) : ''
  if (key && result.message) return `${key}: ${result.message}`
  return key || result.message || ''
}
