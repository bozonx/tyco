import { describe, expect, it, vi } from 'vitest'

import {
  chatFileKind,
  ChatFileError,
  createChatFileInput,
  MAX_CHAT_FILE_BYTES,
  textFileAttachment,
} from './chat-file-input'

const file = (name: string, content = 'text') => new File([content], name)

describe('chat files', () => {
  it('supports the allowlist and rejects executable, legacy office and binary files', () => {
    expect(chatFileKind('PHOTO.JPEG')).toBe('image')
    expect(chatFileKind('report.PDF')).toBe('pdf')
    expect(chatFileKind('report.docx')).toBe('docx')
    expect(chatFileKind('code.ts')).toBe('text')
    for (const name of [
      'app.exe',
      'report.doc',
      'report.xlsx',
      'archive.zip',
      'image.svg',
    ])
      expect(() => chatFileKind(name)).toThrow(ChatFileError)
  })
  it('preserves filenames, decodes BOMs and rejects binary and invalid UTF-8', () => {
    expect(
      textFileAttachment(new TextEncoder().encode('hello'), 'a.md')
    ).toMatchObject({ text: 'hello', name: 'a.md' })
    expect(
      textFileAttachment(new Uint8Array([255, 254, 65, 0]), 'a.txt').text
    ).toBe('A')
    expect(() => textFileAttachment(new Uint8Array([255]), 'a.txt')).toThrow()
    expect(() => textFileAttachment(new Uint8Array([0, 65]), 'a.txt')).toThrow()
  })
  it('continues after failed files and reports exact filenames and reasons', async () => {
    const accept = vi.fn()
    const report = vi.fn()
    const prepare = vi.fn(async (entry: File) => {
      if (entry.name === 'bad.pdf') throw new ChatFileError('password')
      return { attachments: [{ text: entry.name }], images: [] }
    })
    const input = createChatFileInput({
      prepare,
      accept,
      report,
      imageCount: () => 0,
      fileCount: () => 0,
    })
    await input.add(
      [file('bad.pdf'), file('app.exe'), file('good.txt')],
      () => true
    )
    expect(report.mock.calls).toEqual([
      ['bad.pdf', 'password'],
      ['app.exe', 'unsupported'],
    ])
    expect(accept).toHaveBeenCalledExactlyOnceWith({
      attachments: [{ text: 'good.txt' }],
      images: [],
    })
  })
  it('rejects oversized files before the reader and bounds each queued batch', async () => {
    const prepare = vi.fn()
    const report = vi.fn()
    const input = createChatFileInput({
      prepare,
      accept: vi.fn(),
      report,
      imageCount: () => 0,
      fileCount: () => 16,
    })
    await input.add(
      [
        new File([new Uint8Array(MAX_CHAT_FILE_BYTES + 1)], 'large.txt'),
        file('a.txt'),
      ],
      () => true
    )
    expect(report.mock.calls).toEqual([
      ['large.txt', 'size'],
      ['a.txt', 'fileLimit'],
    ])
    expect(prepare).not.toHaveBeenCalled()
  })
  it('discards late completion after a draft changes', async () => {
    let resolve!: (result: { attachments: []; images: [] }) => void
    let current = true
    const accept = vi.fn()
    const prepare = vi.fn(
      () =>
        new Promise<{ attachments: []; images: [] }>((done) => {
          resolve = done
        })
    )
    const input = createChatFileInput({
      prepare,
      accept,
      report: vi.fn(),
      imageCount: () => 0,
      fileCount: () => 0,
    })
    const task = input.add([file('a.txt'), file('b.txt')], () => current)
    await Promise.resolve()
    current = false
    resolve({ attachments: [], images: [] })
    await task
    expect(accept).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalledTimes(1)
  })
})

describe('native file drops', () => {
  it('does not import into a draft changed during native disk IO', async () => {
    const { importDroppedChatFiles } = await import('./chat-file-input')
    let current = true
    const accept = vi.fn()
    await importDroppedChatFiles(
      ['/tmp/a.txt'],
      {
        read: async () => {
          current = false
          return file('a.txt')
        },
        accept,
        report: vi.fn(),
      },
      () => current
    )
    expect(accept).not.toHaveBeenCalled()
  })
})
