import { describe, expect, it } from 'vitest'

import { cleanLlmOutput } from './llm-output'

describe('cleanLlmOutput', () => {
  it('returns an output without wrapping unchanged', () => {
    expect(cleanLlmOutput(' Fixed text\n', 'Fixd text')).toBe(' Fixed text\n')
  })

  it('strips a code fence the source did not have', () => {
    expect(cleanLlmOutput('```\nFixed text\n```', 'Fixd text')).toBe(
      'Fixed text'
    )
    expect(cleanLlmOutput('```js\nx\n```', '```js\nx\n```')).toBe(
      '```js\nx\n```'
    )
  })

  it('strips a lead-in in English and Russian', () => {
    expect(
      cleanLlmOutput('Here is the corrected text:\nFixed text', 'Fixd text')
    ).toBe('Fixed text')
    expect(cleanLlmOutput('Исправленный текст: Привет', 'Првет')).toBe('Привет')
  })

  it('keeps a lead-in the source starts with', () => {
    expect(cleanLlmOutput('Result: done', 'Result: dnoe')).toBe('Result: done')
  })

  it('keeps a lead-in that is the whole output', () => {
    expect(cleanLlmOutput('Translation:', 'Translaton:')).toBe('Translation:')
  })

  it('strips a wrapper tag the source did not have', () => {
    expect(
      cleanLlmOutput('<translation>\nПривет\n</translation>', 'Hello')
    ).toBe('Привет')
    expect(cleanLlmOutput('<text>x</text>', '<text>y</text>')).toBe(
      '<text>x</text>'
    )
  })
})
