import type { ChatHistoryItem, ChatMessage } from '@tyco/shared'

export interface PreparedChatRequest {
  userMessage: ChatMessage
  preparedMessage: string
}

export function prepareChatRequest(
  message: string,
  attachments: string[] = []
): PreparedChatRequest {
  const attachString = attachments
    .map((item) => `=== ATTACHMENT START ===\n${item}\n=== ATTACHMENT END ===`)
    .join('\n\n')

  return {
    userMessage: {
      role: 'user',
      content: message,
      ...(attachments.length ? { attachments: [...attachments] } : {}),
    },
    preparedMessage: [attachString, message].filter(Boolean).join('\n\n'),
  }
}

export function createAssistantMessage(content: string): ChatMessage {
  return { role: 'assistant', content }
}

/** Keeps complete recent turns within a conservative character budget. */
export function trimChatContext(
  messages: ChatMessage[],
  maxCharacters: number
): ChatMessage[] {
  const turns: ChatMessage[][] = []
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([message])
    else turns.at(-1)!.push(message)
  }

  const selected: ChatMessage[][] = []
  let used = 0
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    const size = turn.reduce(
      (sum, item) =>
        sum + item.content.length + (item.attachments || []).join('').length,
      0
    )
    if (selected.length > 0 && used + size > maxCharacters) break
    selected.unshift(turn)
    used += size
  }
  return selected.flat()
}

export function createChatHistoryEntry(params: {
  id: string
  description: string
  lastMsgDate: string
  messages: ChatMessage[]
}): ChatHistoryItem {
  return {
    id: params.id,
    description: params.description,
    lastMsgDate: params.lastMsgDate,
    messages: params.messages,
  }
}
