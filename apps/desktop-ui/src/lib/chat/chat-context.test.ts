import { describe, expect, it } from 'vitest'
import {
  CORE_MEMORY_HARD_LIMIT_TOKENS,
  CORE_MEMORY_WARN_TOKENS,
  estimateMemoryTokens,
  OMITTED_TOOL_RESULT,
  tokensToCharacters,
  TOPIC_MEMORY_HARD_LIMIT_TOKENS,
  TOPIC_MEMORY_WARN_TOKENS,
  trimChatContext,
} from './chat-context'

describe('trimChatContext', () => {
  it('keeps complete recent turns within the context budget', () => {
    const messages = [
      { role: 'user' as const, content: 'old question' },
      { role: 'assistant' as const, content: 'old answer' },
      { role: 'user' as const, content: 'new question' },
      { role: 'assistant' as const, content: 'new answer' },
    ]

    expect(trimChatContext(messages, 25)).toEqual(messages.slice(2))
  })

  it('drops the newest turn when it alone exceeds the budget', () => {
    const newest = { role: 'user' as const, content: 'x'.repeat(100) }
    expect(trimChatContext([newest], 10)).toEqual([])
  })
})

describe('image context', () => {
  const image = {
    id: 'image',
    mediaType: 'image/webp' as const,
    width: 1,
    height: 1,
    size: 3,
  }
  it('trims entire turns when image slots or budget are exhausted', () => {
    const messages = [
      { role: 'user' as const, content: 'Image question', images: [image] },
      { role: 'assistant' as const, content: 'Image answer' },
      { role: 'user' as const, content: 'Recent question' },
      { role: 'assistant' as const, content: 'Recent answer' },
    ]
    expect(trimChatContext(messages, 1000)).toEqual(messages.slice(2))
    expect(trimChatContext(messages, 100_000, 0)).toEqual(messages.slice(2))
  })
})

it('keeps previous image turns when the new message fills four image slots', () => {
  const image = {
    id: 'old',
    mediaType: 'image/webp' as const,
    width: 100,
    height: 100,
    size: 100,
  }
  const messages = [
    { role: 'user' as const, content: 'old image', images: [image] },
    { role: 'assistant' as const, content: 'old answer' },
  ]
  expect(trimChatContext(messages, 100_000)).toEqual(messages)
})

describe('tool steps in the context', () => {
  const toolTurn = (output: string) => [
    { role: 'user' as const, content: 'Read it' },
    {
      role: 'assistant' as const,
      content: 'Done',
      parts: [
        {
          type: 'tool-call' as const,
          toolCallId: 'c1',
          toolName: 'read',
          input: {},
          state: 'done' as const,
        },
        {
          type: 'tool-result' as const,
          toolCallId: 'c1',
          toolName: 'read',
          output,
          isTruncated: true,
        },
        { type: 'text' as const, text: 'Done' },
      ],
    },
  ]

  it('counts tool calls and results', () => {
    const messages = toolTurn('x'.repeat(100))
    expect(trimChatContext(messages, 10_000)).toEqual(messages)
    // 7 + 4 + 4 + 2 + 100: the result alone does not fit 50
    expect(trimChatContext(messages, 50)).not.toEqual(messages)
  })

  it('omits old tool results before dropping a turn', () => {
    const old = toolTurn('x'.repeat(1000))
    const recent = [
      { role: 'user' as const, content: 'Next' },
      { role: 'assistant' as const, content: 'Answer' },
    ]

    const trimmed = trimChatContext([...old, ...recent], 100)

    expect(trimmed).toHaveLength(4)
    expect(trimmed[1].parts?.[1]).toEqual({
      type: 'tool-result',
      toolCallId: 'c1',
      toolName: 'read',
      output: OMITTED_TOOL_RESULT,
      isTruncated: undefined,
    })
    expect(trimmed[1].parts?.[0]).toEqual(old[1].parts?.[0])
    // the stored messages are left as they are
    expect(old[1].parts?.[1]).toMatchObject({ output: 'x'.repeat(1000) })
  })

  it('keeps tool results while everything fits', () => {
    const messages = toolTurn('result')
    expect(trimChatContext(messages, 10_000)[1].parts?.[1]).toMatchObject({
      output: 'result',
    })
  })
})

describe('memory token limits and budget', () => {
  it('exposes memory limits in tokens', () => {
    expect(CORE_MEMORY_WARN_TOKENS).toBe(1000)
    expect(CORE_MEMORY_HARD_LIMIT_TOKENS).toBe(1500)
    expect(TOPIC_MEMORY_WARN_TOKENS).toBe(2500)
    expect(TOPIC_MEMORY_HARD_LIMIT_TOKENS).toBe(4000)
  })

  it('converts tokens and estimates memory size', () => {
    expect(tokensToCharacters(1000)).toBe(3000)
    expect(estimateMemoryTokens('x'.repeat(300))).toBe(100)
  })
})
