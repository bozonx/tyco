import { describe, expect, it } from 'vitest'

import {
  cleanGeneratedTitle,
  draftChatTitle,
  draftTitleOf,
  needsGeneratedTitle,
} from './chat-title'

describe('chat-title', () => {
  it('keeps a short first message as it is, on one line', () => {
    expect(draftChatTitle('  How to\nbake bread? ')).toBe('How to bake bread?')
  })

  it('cuts a long first message at a word', () => {
    const title = draftChatTitle(
      'Please explain in detail how the borrow checker in Rust decides lifetimes'
    )
    expect(title).toBe(
      'Please explain in detail how the borrow checker in Rust…'
    )
    expect(title.length).toBeLessThanOrEqual(61)
  })

  it('generates a title once, after the first answer', () => {
    const first = [
      { role: 'user' as const, content: 'Hi there' },
      { role: 'assistant' as const, content: 'Hello' },
    ]
    expect(needsGeneratedTitle(first, 'Hi there', 'Image')).toBe(true)
    expect(needsGeneratedTitle(first, 'Renamed', 'Image')).toBe(false)
    expect(needsGeneratedTitle(first.slice(0, 1), 'Hi there', 'Image')).toBe(
      false
    )
    expect(
      needsGeneratedTitle(
        [...first, { role: 'user', content: 'More' }, first[1]],
        'Hi there',
        'Image'
      )
    ).toBe(false)
  })

  it('generates a title for a chat begun with an image or a file only', () => {
    const answer = { role: 'assistant' as const, content: 'A cat' }
    const image = [{ role: 'user' as const, content: '' }, answer]
    expect(needsGeneratedTitle(image, 'Image', 'Image')).toBe(true)
    const file = [
      {
        role: 'user' as const,
        content: '',
        attachments: [
          { text: 'data', source: 'selection' as const, name: 'a.txt' },
        ],
      },
      answer,
    ]
    expect(draftTitleOf(file[0], 'Image')).toBe('a.txt')
    expect(needsGeneratedTitle(file, 'a.txt', 'Image')).toBe(true)
  })

  it('cleans what the model answered', () => {
    expect(cleanGeneratedTitle('"Baking bread at home."\n')).toBe(
      'Baking bread at home'
    )
    expect(cleanGeneratedTitle('Title: **Rust lifetimes**')).toBe(
      'Rust lifetimes'
    )
    expect(cleanGeneratedTitle('«Выпечка хлеба»')).toBe('Выпечка хлеба')
    expect(cleanGeneratedTitle('\n\n')).toBe('')
  })
})
