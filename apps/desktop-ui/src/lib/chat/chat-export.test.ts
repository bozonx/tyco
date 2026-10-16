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
        attachments: [{ text: 'context code snippet' }],
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
        attachments: [{ text: 'line 1\nline 2' }],
      },
    ]

    const result = formatChatToMarkdown(messages)
    expect(result).toContain('> line 1\n> line 2')
  })
})

it('marks images omitted from text export without leaking internal paths', () => {
  const markdown = formatChatToMarkdown([
    {
      role: 'user',
      content: '',
      images: [
        {
          id: 'internal-id',
          mediaType: 'image/webp',
          width: 32,
          height: 24,
          size: 100,
        },
      ],
    },
  ])
  expect(markdown).toContain('[Image omitted: 32 × 24, image/webp]')
  expect(markdown).not.toContain('internal-id')
})

it('lists the tool calls of an answer in a short block', () => {
  const markdown = formatChatToMarkdown([
    {
      role: 'assistant',
      content: 'It is noon.',
      parts: [
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'get_current_time',
          input: {},
          state: 'done',
        },
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'get_current_time',
          output: '12:00',
        },
        {
          type: 'tool-call',
          toolCallId: 'c2',
          toolName: 'delete_file',
          input: {},
          state: 'denied',
        },
      ],
    },
  ])

  expect(markdown).toBe(
    '### Assistant\n\n> Tool `get_current_time`: done\n> Tool `delete_file`: denied\n\nIt is noon.'
  )
})
