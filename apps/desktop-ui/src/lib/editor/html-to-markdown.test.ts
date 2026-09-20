import { describe, expect, it } from 'vitest'

import { htmlToMarkdown } from './htmlToMarkdown'

describe('htmlToMarkdown', () => {
  it('converts headings', () => {
    expect(htmlToMarkdown('<h1>Заголовок</h1><h2>Второй</h2>')).toBe(
      '# Заголовок\n\n## Второй'
    )
  })

  it('keeps the application bullet style', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe(
      '- one\n- two'
    )
  })

  it('converts nested lists', () => {
    const markdown = htmlToMarkdown(
      '<ul><li>one<ul><li>inner</li></ul></li><li>two</li></ul>'
    )

    expect(markdown).toContain('- one')
    expect(markdown).toContain('- inner')
    expect(markdown.indexOf('inner')).toBeGreaterThan(markdown.indexOf('one'))
  })

  it('converts ordered lists', () => {
    expect(htmlToMarkdown('<ol><li>one</li><li>two</li></ol>')).toBe(
      '1. one\n2. two'
    )
  })

  it('converts links', () => {
    expect(htmlToMarkdown('<p>see <a href="https://a.b">site</a></p>')).toBe(
      'see [site](https://a.b)'
    )
  })

  it('converts emphasis', () => {
    expect(htmlToMarkdown('<p><strong>bold</strong> <em>italic</em></p>')).toBe(
      '**bold** *italic*'
    )
  })

  it('converts pre/code into a fenced block', () => {
    const markdown = htmlToMarkdown(
      '<pre><code>const a = 1\nconst b = 2</code></pre>'
    )

    expect(markdown).toBe('```\nconst a = 1\nconst b = 2\n```')
  })

  it('keeps inline code', () => {
    expect(htmlToMarkdown('<p>run <code>npm i</code></p>')).toBe(
      'run `npm i`'
    )
  })

  it('converts a table', () => {
    const markdown = htmlToMarkdown(
      '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>'
    )

    expect(markdown).toContain('a')
    expect(markdown).toContain('1')
  })

  it('drops office clipboard wrappers', () => {
    const markdown = htmlToMarkdown(
      '<html><head><meta charset="utf-8"><style>p { color: red }</style></head>' +
        '<body><!--StartFragment--><p>текст</p><!--EndFragment--></body></html>'
    )

    expect(markdown).toBe('текст')
  })

  it('returns an empty string for empty markup', () => {
    expect(htmlToMarkdown('<div></div>')).toBe('')
  })
})
