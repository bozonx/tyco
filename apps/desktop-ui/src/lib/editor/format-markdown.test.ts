import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARKDOWN_SETTINGS,
  DEFAULT_MARKDOWN_CLEAN_SETTINGS,
  normalizeMarkdownSettings,
  normalizeMarkdownCleanSettings,
} from '@tyco/shared'
import { formatMarkdown } from './format-markdown'
import { htmlToMarkdown } from './html-to-markdown'

describe('shared Markdown formatting', () => {
  it('keeps content and heading hierarchy instead of editorial changes', () => {
    const input =
      '# First.\n\n# Second.\n\n- Text (note).\n\n```js\nconst x=1\n```\n'
    const output = formatMarkdown(input)
    expect(output).toContain('# First.')
    expect(output).toContain('# Second.')
    expect(output).toContain('- Text (note).')
    expect(output).toContain('const x=1')
    expect(output).not.toContain('*(note)*')
  })
  it('shares style between HTML paste and the format button', () => {
    const settings = {
      bullet: '+',
      emphasis: '_',
      strong: '_',
      headingStyle: 'setext',
      incrementListMarker: false,
    }
    const pasted = htmlToMarkdown(
      '<h1>Title</h1><ul><li><em>one</em></li><li><strong>two</strong></li></ul>',
      settings
    )
    expect(pasted).toContain('+ _one_')
    expect(pasted).toContain('+ __two__')
    expect(pasted).toContain('=====')
    expect(formatMarkdown(pasted, settings).trim()).toBe(pasted)
  })
  it('supports GFM tables, tasks and strikethrough', () => {
    const input = '| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] ~~done~~\n'
    const output = formatMarkdown(input)
    expect(output).toContain('| A')
    expect(output).toContain('[x] ~~done~~')
    expect(formatMarkdown(output)).toBe(output)
  })
  it('collapses whitespace runs in prose', () => {
    const input =
      '# Big   title\n\nword   word\tend  *a  b*\n\n- item  \t two\n\n| a  b | c |\n| - | - |\n| x   y | z |\n'
    const output = formatMarkdown(input)
    expect(output).toContain('# Big title')
    expect(output).toContain('word word end *a b*')
    expect(output).toContain('- item two')
    expect(output).toContain('| a b |')
    expect(output).toContain('| x y |')
  })
  it('keeps whitespace in code, HTML and non-breaking spaces', () => {
    const input =
      'a  b `x   y`\n\n```\ncode   x\n```\n\n<div>  raw   html  </div>\n'
    const output = formatMarkdown(input)
    expect(output).toContain('a  b')
    expect(output).toContain('`x   y`')
    expect(output).toContain('code   x')
    expect(output).toContain('<div>  raw   html  </div>')
  })
  it('does not cache the previous paste settings', () => {
    const html = '<ul><li>one</li></ul>'
    expect(htmlToMarkdown(html, { bullet: '*' })).toBe('* one')
    expect(htmlToMarkdown(html, { bullet: '+' })).toBe('+ one')
    expect(htmlToMarkdown(html)).toBe('- one')
  })
})

describe('Markdown settings', () => {
  it('supplies defaults and rejects malformed saved values', () => {
    expect(normalizeMarkdownSettings(undefined)).toEqual(
      DEFAULT_MARKDOWN_SETTINGS
    )
    expect(
      normalizeMarkdownSettings({
        bullet: '?',
        emphasis: false,
        headingStyle: 'unknown',
      })
    ).toEqual(DEFAULT_MARKDOWN_SETTINGS)
  })
  it('uses the shared ordered list numbering setting', () => {
    const input = '1. one\n2. two\n'
    expect(formatMarkdown(input, { incrementListMarker: false })).toBe(
      '1. one\n1. two\n'
    )
    expect(
      htmlToMarkdown('<ol><li>one</li><li>two</li></ol>', {
        incrementListMarker: false,
      })
    ).toBe('1. one\n1. two')
  })
})

describe('Markdown clean settings', () => {
  it('supplies defaults and handles invalid values', () => {
    expect(normalizeMarkdownCleanSettings(undefined)).toEqual(
      DEFAULT_MARKDOWN_CLEAN_SETTINGS
    )
    expect(
      normalizeMarkdownCleanSettings({
        bullet: 'invalid',
        codeBlockIndent: 'invalid',
        blockquoteIndent: 'invalid',
        linkFormat: 'invalid',
        keepInlineCode: 'notABool',
        keepTaskCheckboxes: 'notABool',
      })
    ).toEqual({
      ...DEFAULT_MARKDOWN_CLEAN_SETTINGS,
      keepInlineCode: false,
      keepTaskCheckboxes: true,
    })
  })
})
