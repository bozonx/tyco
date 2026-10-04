import { describe, expect, it } from 'vitest'

import {
  cleanGeneratedTitle,
  draftChatTitle,
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
    expect(needsGeneratedTitle(first, 'Hi there')).toBe(true)
    expect(needsGeneratedTitle(first, 'Renamed')).toBe(false)
    expect(needsGeneratedTitle(first.slice(0, 1), 'Hi there')).toBe(false)
    expect(
      needsGeneratedTitle(
        [...first, { role: 'user', content: 'More' }, first[1]],
        'Hi there'
      )
    ).toBe(false)
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
