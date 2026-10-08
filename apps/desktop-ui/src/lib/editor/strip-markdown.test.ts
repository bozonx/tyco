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

  it('supports custom bullet style and stripping bullets entirely', () => {
    const md = '- item 1\n- item 2'
    expect(stripMarkdown(md, { bullet: '*' })).toBe('* item 1\n* item 2')
    expect(stripMarkdown(md, { bullet: 'none' })).toBe('item 1\nitem 2')
  })

  it('supports keeping or removing task checkboxes', () => {
    const md = '- [x] done\n- [ ] todo'
    expect(stripMarkdown(md, { keepTaskCheckboxes: true })).toBe(
      '- [x] done\n- [ ] todo'
    )
    expect(stripMarkdown(md, { keepTaskCheckboxes: false })).toBe(
      '- done\n- todo'
    )
  })

  it('supports keeping inline code markup', () => {
    const md = 'Run `npm test` here.'
    expect(stripMarkdown(md, { keepInlineCode: true })).toBe(
      'Run `npm test` here.'
    )
    expect(stripMarkdown(md, { keepInlineCode: false })).toBe(
      'Run npm test here.'
    )
  })

  it('supports link format options', () => {
    const md = 'See [Google](https://google.com) and <https://example.com>.'
    expect(stripMarkdown(md, { linkFormat: 'text' })).toBe(
      'See Google and https://example.com.'
    )
    expect(stripMarkdown(md, { linkFormat: 'textAndUrl' })).toBe(
      'See Google (https://google.com) and https://example.com.'
    )
    expect(stripMarkdown(md, { linkFormat: 'url' })).toBe(
      'See https://google.com and https://example.com.'
    )
  })

  it('indents code blocks according to settings', () => {
    const md = '```js\nconst a = 1\nconst b = 2\n```'
    expect(stripMarkdown(md, { codeBlockIndent: 'none' })).toBe(
      'const a = 1\nconst b = 2'
    )
    expect(stripMarkdown(md, { codeBlockIndent: '2spaces' })).toBe(
      '  const a = 1\n  const b = 2'
    )
    expect(stripMarkdown(md, { codeBlockIndent: '4spaces' })).toBe(
      '    const a = 1\n    const b = 2'
    )
    expect(stripMarkdown(md, { codeBlockIndent: 'tab' })).toBe(
      '\tconst a = 1\n\tconst b = 2'
    )
  })

  it('styles blockquotes according to settings', () => {
    const md = '> Line 1\n> Line 2'
    expect(stripMarkdown(md, { blockquoteIndent: 'none' })).toBe(
      'Line 1\nLine 2'
    )
    expect(stripMarkdown(md, { blockquoteIndent: 'angle' })).toBe(
      '> Line 1\n> Line 2'
    )
    expect(stripMarkdown(md, { blockquoteIndent: '2spaces' })).toBe(
      '  Line 1\n  Line 2'
    )
    expect(stripMarkdown(md, { blockquoteIndent: '4spaces' })).toBe(
      '    Line 1\n    Line 2'
    )
    expect(stripMarkdown(md, { blockquoteIndent: 'tab' })).toBe(
      '\tLine 1\n\tLine 2'
    )
  })

  it('supports image format options', () => {
    const md = 'Here is ![Alt text](https://example.com/pic.png).'
    expect(stripMarkdown(md, { imageFormat: 'alt' })).toBe(
      'Here is Alt text.'
    )
    expect(stripMarkdown(md, { imageFormat: 'altAndUrl' })).toBe(
      'Here is Alt text (https://example.com/pic.png).'
    )
    expect(stripMarkdown(md, { imageFormat: 'url' })).toBe(
      'Here is https://example.com/pic.png.'
    )
    expect(stripMarkdown(md, { imageFormat: 'none' })).toBe('Here is .')
  })

  it('supports keeping or stripping horizontal rules', () => {
    const md = 'First section\n\n---\n\nSecond section'
    expect(stripMarkdown(md, { keepThematicBreaks: false })).toBe(
      'First section\n\nSecond section'
    )
    expect(stripMarkdown(md, { keepThematicBreaks: true })).toBe(
      'First section\n\n---\n\nSecond section'
    )
  })
})
