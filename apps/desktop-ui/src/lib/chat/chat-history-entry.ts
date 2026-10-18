import type { Chat, ChatMessage } from '@tyco/shared'

export function createChatHistoryEntry(params: {
  id: string
  title: string
  lastMessageAt: number
  messages: ChatMessage[]
}): Chat {
  return {
    id: params.id,
    title: params.title,
    lastMessageAt: params.lastMessageAt,
    messages: params.messages,
  }
}
