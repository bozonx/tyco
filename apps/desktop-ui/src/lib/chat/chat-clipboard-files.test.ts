import { describe, expect, it } from 'vitest'

import { clipboardChatFiles, fileUriToPath } from './chat-clipboard-files'

function clipboard(
  types: Record<string, string>,
  files: File[] = [],
  items: { kind: string; getAsFile: () => File | null }[] = []
) {
  return {
    files: files as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    getData: (type: string) => types[type] || '',
  }
}

describe('chat clipboard files', () => {
  it('attaches files that come without text', () => {
    const file = new File(['pixels'], 'image.png', { type: 'image/png' })
    expect(clipboardChatFiles(clipboard({}, [file]))).toEqual({
      kind: 'files',
      files: [file],
    })
  })

  it('takes a pasted image that is exposed only as an item', () => {
    const file = new File(['pixels'], 'image.png', { type: 'image/png' })
    expect(
      clipboardChatFiles(
        clipboard(
          {},
          [],
          [
            { kind: 'string', getAsFile: () => null },
            { kind: 'file', getAsFile: () => file },
          ]
        )
      )
    ).toEqual({ kind: 'files', files: [file] })
  })

  it('keeps text copied from office apps a text paste', () => {
    const file = new File(['pixels'], 'image.png', { type: 'image/png' })
    expect(
      clipboardChatFiles(clipboard({ 'text/plain': 'Cells' }, [file]))
    ).toBe(null)
    expect(clipboardChatFiles(clipboard({ 'text/plain': 'Text' }))).toBe(null)
    expect(clipboardChatFiles(null)).toBe(null)
  })

  it('reads files copied in a file manager by their paths', () => {
    expect(
      clipboardChatFiles(
        clipboard(
          {
            'text/plain': '/home/me/a b.png\n/home/me/c.pdf',
            'text/uri-list':
              '# copied\r\nfile:///home/me/a%20b.png\r\nfile:///home/me/c.pdf\r\n',
          },
          [new File(['x'], 'a b.png')]
        )
      )
    ).toEqual({ kind: 'paths', paths: ['/home/me/a b.png', '/home/me/c.pdf'] })
  })

  it('pastes links copied in a browser as text', () => {
    expect(
      clipboardChatFiles(
        clipboard({
          'text/plain': 'https://example.com',
          'text/uri-list': 'https://example.com',
        })
      )
    ).toBe(null)
    expect(
      clipboardChatFiles(
        clipboard({
          'text/uri-list': 'file:///home/me/a.png\nhttps://example.com',
        })
      )
    ).toBe(null)
  })

  it('turns local file URIs into paths', () => {
    expect(fileUriToPath('file:///C:/Users/me/%D1%84.png')).toBe(
      'C:/Users/me/ф.png'
    )
    expect(fileUriToPath('file://localhost/tmp/a.png')).toBe('/tmp/a.png')
    expect(fileUriToPath('file://server/share/a.png')).toBe(null)
    expect(fileUriToPath('file:///tmp/%E0%A4%A.png')).toBe(null)
    expect(fileUriToPath('not a uri')).toBe(null)
  })
})
