import type { ChatMessage } from '@tyco/shared'

export function createAssistantMessage(content: string): ChatMessage {
  return { role: 'assistant', content }
}
