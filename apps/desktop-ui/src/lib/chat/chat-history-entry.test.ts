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
        lastMessageAt: '2026-04-22T00:00:00.000Z',
        messages: [userMessage, assistantMessage],
      })
    ).toEqual({
      id: 'chat-1',
      title: 'Question',
      lastMessageAt: '2026-04-22T00:00:00.000Z',
      messages: [userMessage, assistantMessage],
    })
  })
})
