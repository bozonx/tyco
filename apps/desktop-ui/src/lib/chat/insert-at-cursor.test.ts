import { describe, expect, it } from 'vitest'

import { insertAtCursor } from './insert-at-cursor'

describe('insertAtCursor', () => {
  it('appends to the end without a range', () => {
    expect(insertAtCursor('Hello', null, 'world')).toEqual({
      value: 'Hello world',
      caret: 11,
    })
  })

  it('does not add a space after trailing whitespace', () => {
    expect(insertAtCursor('Hello\n', null, 'world').value).toBe('Hello\nworld')
  })

  it('inserts into an empty value as is', () => {
    expect(insertAtCursor('', null, 'text')).toEqual({
      value: 'text',
      caret: 4,
    })
  })

  it('inserts at the caret and separates the neighbouring words', () => {
    expect(insertAtCursor('one three', { start: 3, end: 3 }, 'two')).toEqual({
      value: 'one two three',
      caret: 7,
    })
  })

  it('replaces the selected range', () => {
    expect(insertAtCursor('one XX three', { start: 4, end: 6 }, 'two')).toEqual(
      { value: 'one two three', caret: 7 }
    )
  })

  it('adds a trailing space before a word that follows the caret', () => {
    expect(insertAtCursor('world', { start: 0, end: 0 }, 'Hello')).toEqual({
      value: 'Hello world',
      caret: 5,
    })
  })

  it('clamps a range left from a longer value', () => {
    expect(insertAtCursor('ab', { start: 10, end: 12 }, 'c').value).toBe('ab c')
  })
})
