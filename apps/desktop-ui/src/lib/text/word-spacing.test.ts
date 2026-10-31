import { describe, expect, it } from 'vitest'

import { joinWords, needsSpaceBetween } from './word-spacing'

describe('needsSpaceBetween', () => {
  it('separates two words', () => {
    expect(joinWords('Hello', 'world')).toBe('Hello world')
  })

  it('keeps existing whitespace and empty sides as they are', () => {
    expect(joinWords('Hello ', 'world')).toBe('Hello world')
    expect(joinWords('Hello', '\nworld')).toBe('Hello\nworld')
    expect(needsSpaceBetween('', 'world')).toBe(false)
    expect(needsSpaceBetween('Hello', '')).toBe(false)
  })

  it('does not put a space before closing punctuation', () => {
    expect(joinWords('Hello world', '.')).toBe('Hello world.')
    expect(joinWords('one', ', two')).toBe('one, two')
    expect(joinWords('(see', ')')).toBe('(see)')
    expect(joinWords('你好', '。')).toBe('你好。')
  })

  it('does not put a space after opening punctuation', () => {
    expect(joinWords('(', 'note')).toBe('(note')
    expect(joinWords('«', 'цитата')).toBe('«цитата')
  })

  it('joins scripts written without spaces', () => {
    expect(joinWords('你好', '世界')).toBe('你好世界')
    expect(joinWords('こんにちは', '世界')).toBe('こんにちは世界')
    expect(joinWords('𠀀', '世界')).toBe('𠀀世界')
  })

  it('separates a spaced word from an unspaced one', () => {
    expect(joinWords('你好', 'Tyco')).toBe('你好 Tyco')
  })
})
