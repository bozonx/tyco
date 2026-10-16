import type { ChatMessage, ChatMessagePart } from '@tyco/shared'

import type { ChatToolLoopState } from './chat-tool-loop'

/** Whether the parts hold anything besides the answer's text */
export function hasToolSteps(parts: readonly ChatMessagePart[] | undefined) {
  return parts?.some((part) => part.type !== 'text') ?? false
}

/** Whether an answer has anything to keep: text, or steps the user saw */
export function hasAnswer(message: Pick<ChatMessage, 'content' | 'parts'>) {
  return Boolean(message.content) || hasToolSteps(message.parts)
}

/**
 * Puts the answer so far into the message. Plain answers keep no parts, so they
 * are stored exactly as before tools existed
 */
export function applyAnswerState(
  message: ChatMessage,
  answer: ChatToolLoopState
) {
  message.content = answer.content
  if (hasToolSteps(answer.parts)) message.parts = answer.parts
  else delete message.parts
}

/**
 * Closes the calls a stopped answer left open: one that waited for approval was
 * never allowed, one that was running has no result to show
 */
export function settleUnfinishedToolCalls(message: ChatMessage) {
  if (!message.parts) return
  for (const part of message.parts) {
    if (part.type !== 'tool-call') continue
    if (part.state === 'awaiting-approval') {
      part.state = 'denied'
      delete part.approvalId
    } else if (part.state === 'pending') {
      part.state = 'error'
    }
  }
}

type ToolCallPart = Extract<ChatMessagePart, { type: 'tool-call' }>
type ToolResultPart = Extract<ChatMessagePart, { type: 'tool-result' }>

/** One block of an answer on screen: its text, or a tool call with its result */
export type ChatMessageStep =
  | { type: 'text'; text: string }
  | { type: 'tool'; call: ToolCallPart; result?: ToolResultPart }

/**
 * What an answer with tool calls shows, in order; null for a plain answer,
 * which is shown from `content` as before
 */
export function messageSteps(message: ChatMessage): ChatMessageStep[] | null {
  const parts = message.parts
  if (!parts?.some((part) => part.type === 'tool-call')) return null
  const results = new Map(
    parts
      .filter((part) => part.type === 'tool-result')
      .map((part) => [part.toolCallId, part])
  )
  return parts.flatMap((part): ChatMessageStep[] => {
    if (part.type === 'text') return part.text ? [part] : []
    if (part.type === 'tool-call')
      return [
        { type: 'tool', call: part, result: results.get(part.toolCallId) },
      ]
    return []
  })
}
