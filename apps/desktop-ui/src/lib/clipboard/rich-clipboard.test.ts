import { afterEach, describe, expect, it, vi } from 'vitest'

import { hasMarkup, markdownToHtml, writeMarkdown } from './rich-clipboard'

class FakeClipboardItem {
  constructor(public readonly parts: Record<string, Blob>) {}
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('writeMarkdown', () => {
  it('writes the HTML and the Markdown source of a formatted text', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    const write = vi.fn(async () => {})
    const writeText = vi.fn(async () => {})

    await writeMarkdown('Some **bold** [link](https://a.b)', {
      write,
      writeText,
    })

    const [[items]] = write.mock.calls as unknown as [[FakeClipboardItem[]]]
    const parts = items[0]!.parts
    expect(await parts['text/plain']!.text()).toBe(
      'Some **bold** [link](https://a.b)'
    )
    expect(await parts['text/html']!.text()).toContain(
      '<strong>bold</strong> <a href="https://a.b">link</a>'
    )
    expect(writeText).not.toHaveBeenCalled()
  })

  it('writes a text without markup as plain text', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    const write = vi.fn(async () => {})
    const writeText = vi.fn(async () => {})

    await writeMarkdown('Just text', { write, writeText })

    expect(write).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith('Just text')
  })

  it('falls back to plain text when the rich write fails', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    const write = vi.fn(async () => {
      throw new Error('not allowed')
    })
    const writeText = vi.fn(async () => {})

    await writeMarkdown('**bold**', { write, writeText })

    expect(writeText).toHaveBeenCalledWith('**bold**')
  })
})

describe('markdown helpers', () => {
  it('tells markup from plain text', () => {
    expect(hasMarkup('a *b*')).toBe(true)
    expect(hasMarkup('a b')).toBe(false)
    expect(markdownToHtml('# T')).toBe('<h1>T</h1>')
  })
})
