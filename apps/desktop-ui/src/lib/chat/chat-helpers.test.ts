import { describe, expect, it } from 'vitest'

import {
  createAssistantMessage,
  createChatHistoryEntry,
  prepareChatRequest,
  trimChatContext,
} from './chat-helpers'

describe('chat-helpers', () => {
  it('prepares a chat request with attachments', () => {
    const result = prepareChatRequest('Hello', ['file-a', 'file-b'])

    expect(result.userMessage).toEqual({
      role: 'user',
      content: 'Hello',
      attachments: ['file-a', 'file-b'],
    })

    expect(result.preparedMessage).toContain('=== ATTACHMENT START ===')
    expect(result.preparedMessage).toContain('Hello')
  })

  it('creates a history entry from prepared messages', () => {
    const userMessage = { role: 'user' as const, content: 'Question' }
    const assistantMessage = createAssistantMessage('Answer')

    expect(
      createChatHistoryEntry({
        id: 'chat-1',
        description: 'Question',
        lastMsgDate: '2026-04-22T00:00:00.000Z',
        messages: [userMessage, assistantMessage],
      })
    ).toEqual({
      id: 'chat-1',
      description: 'Question',
      lastMsgDate: '2026-04-22T00:00:00.000Z',
      messages: [userMessage, assistantMessage],
    })
  })

  it('keeps complete recent turns within the context budget', () => {
    const messages = [
      { role: 'user' as const, content: 'old question' },
      { role: 'assistant' as const, content: 'old answer' },
      { role: 'user' as const, content: 'new question' },
      { role: 'assistant' as const, content: 'new answer' },
    ]

    expect(trimChatContext(messages, 25)).toEqual(messages.slice(2))
  })

  it('keeps the newest turn when it alone exceeds the budget', () => {
    const newest = { role: 'user' as const, content: 'x'.repeat(100) }
    expect(trimChatContext([newest], 10)).toEqual([newest])
  })
})
