import { describe, expect, it } from 'vitest'
import { createChatHistoryEntry } from './chat-history-entry'

describe('createChatHistoryEntry', () => {
  it('creates a history entry from prepared messages', () => {
    const userMessage = { role: 'user' as const, content: 'Question' }
    const assistantMessage = { role: 'assistant' as const, content: 'Answer' }

    expect(
      createChatHistoryEntry({
        id: 'chat-1',
        title: 'Question',
        lastMessageAt: 1_776_816_000_000,
        messages: [userMessage, assistantMessage],
      })
    ).toEqual({
      id: 'chat-1',
      title: 'Question',
      lastMessageAt: 1_776_816_000_000,
      messages: [userMessage, assistantMessage],
    })
  })
})
