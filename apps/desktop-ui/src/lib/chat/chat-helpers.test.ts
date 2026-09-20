import { describe, expect, it } from 'vitest'

import {
  createAssistantMessage,
  createChatHistoryEntry,
  prepareChatRequest,
} from './chat-helpers'

describe('chat-helpers', () => {
  it('prepares a chat request with attachments and role instructions', () => {
    const result = prepareChatRequest(
      'Hello',
      ['file-a', 'file-b'],
      'Be concise'
    )

    expect(result.userMessage).toEqual({
      role: 'user',
      content: [
        '=== ATTACHMENT START ===\nfile-a\n=== ATTACHMENT END ===',
        '=== ATTACHMENT START ===\nfile-b\n=== ATTACHMENT END ===',
        'Hello',
      ].join('\n\n'),
    })

    expect(result.preparedMessage).toContain('=== ROLE/RULES START ===')
    expect(result.preparedMessage).toContain('Be concise')
    expect(result.preparedMessage).toContain('Hello')
  })

  it('creates a history entry from prepared messages', () => {
    const userMessage = {
      role: 'user' as const,
      content: 'Question',
    }
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
})
