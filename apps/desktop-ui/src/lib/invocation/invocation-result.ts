import type { ToolResult } from '../tools/tool-types'

/** The text of a tool result: the translated key, then the plain detail */
export function toolResultMessage(
  result: Pick<ToolResult, 'messageKey' | 'message'>,
  t: (key: string) => string
): string {
  const key = result.messageKey ? t(result.messageKey) : ''
  if (key && result.message) return `${key}: ${result.message}`
  return key || result.message || ''
}
