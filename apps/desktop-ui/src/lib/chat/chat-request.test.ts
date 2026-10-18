import { describe, expect, it } from 'vitest'
import { prepareChatRequest } from './chat-request'

describe('prepareChatRequest', () => {
  it('prepares a chat request with attachments', () => {
    const result = prepareChatRequest('Hello', [
      { text: 'file-a' },
      { text: 'file-b', source: 'editorText' },
    ])

    expect(result.userMessage).toEqual({
      role: 'user',
      content: 'Hello',
      attachments: [
        { text: 'file-a' },
        { text: 'file-b', source: 'editorText' },
      ],
    })

    expect(result.promptText).toContain('<attachment>\nfile-a\n</attachment>')
    expect(result.promptText).toContain(
      '<attachment source="editorText">\nfile-b\n</attachment>'
    )
    expect(result.promptText).toContain('Hello')
  })
})
