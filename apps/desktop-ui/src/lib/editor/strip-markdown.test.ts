import { describe, expect, it } from 'vitest'

import { stripMarkdown } from './strip-markdown'

describe('stripMarkdown', () => {
  it('drops inline markup and keeps the text', () => {
    expect(
      stripMarkdown(
        'Some **bold**, *italic*, ~~old~~ and `code` [here](https://x.y).'
      )
    ).toBe('Some bold, italic, old and code here.')
  })

  it('keeps blocks apart and lists as plain bullets', () => {
    expect(
      stripMarkdown(
        '# Title\n\n> quoted\n\n- one\n- two\n\n1. first\n2. second\n\n---\n\n```js\nlet a = 1\n```'
      )
    ).toBe(
      'Title\n\nquoted\n\n- one\n- two\n\n1. first\n2. second\n\nlet a = 1'
    )
  })

  it('splits table cells by tabs', () => {
    expect(stripMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a\tb\n1\t2')
  })

  it('leaves plain text as it is', () => {
    expect(stripMarkdown('Just a line')).toBe('Just a line')
  })
})
