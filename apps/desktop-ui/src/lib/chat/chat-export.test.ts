import { describe, expect, it } from 'vitest'

import { formatChatToMarkdown } from './chat-export'
import type { ChatMessage } from '@tyco/shared'

describe('formatChatToMarkdown', () => {
  it('formats an empty dialogue', () => {
    expect(formatChatToMarkdown([])).toBe('')
    expect(formatChatToMarkdown([], { title: 'Test Chat' })).toBe('# Test Chat')
  })

  it('formats user and assistant messages with attachments', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Hello, what is this?',
        attachments: ['context code snippet'],
      },
      { role: 'assistant', content: 'It is a code snippet.' },
    ]

    const result = formatChatToMarkdown(messages, { title: 'Dialogue Title' })

    expect(result).toBe(
      `# Dialogue Title\n\n### User\n\n> context code snippet\n\nHello, what is this?\n\n### Assistant\n\nIt is a code snippet.`
    )
  })

  it('handles multi-line attachments', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Explain this',
        attachments: ['line 1\nline 2'],
      },
    ]

    const result = formatChatToMarkdown(messages)
    expect(result).toContain('> line 1\n> line 2')
  })
})
