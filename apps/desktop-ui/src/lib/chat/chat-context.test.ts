import { describe, expect, it } from 'vitest'
import { trimChatContext } from './chat-context'

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
