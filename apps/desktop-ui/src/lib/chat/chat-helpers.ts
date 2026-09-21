import type { ChatHistoryItem, ChatMessage } from '@tyco/shared'

export interface PreparedChatRequest {
  userMessage: ChatMessage
  preparedMessage: string
}

export function prepareChatRequest(
  message: string,
  attachments: string[] = [],
  role = ''
): PreparedChatRequest {
  const attachString = attachments
    .map((item) => `=== ATTACHMENT START ===\n${item}\n=== ATTACHMENT END ===`)
    .join('\n\n')

  const roleString = role
    ? `=== ROLE/RULES START ===\n${role}\n=== ROLE/RULES END ===`
    : ''

  return {
    userMessage: {
      role: 'user',
      content: message,
      ...(attachments.length ? { attachments: [...attachments] } : {}),
    },
    preparedMessage: [attachString, roleString, message]
      .filter(Boolean)
      .join('\n\n'),
  }
}

export function createAssistantMessage(content: string): ChatMessage {
  return { role: 'assistant', content }
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
