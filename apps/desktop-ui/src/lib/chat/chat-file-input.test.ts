import { describe, expect, it, vi } from 'vitest'

import { chatFileErrorKind } from './chat-file-error'
import {
  chatFileKind,
  ChatFileError,
  createChatFileInput,
  MAX_CHAT_FILE_BYTES,
  mayContainSecrets,
  textFileAttachment,
} from './chat-file-input'

const file = (name: string, content = 'text') => new File([content], name)

describe('chat files', () => {
  it('reads known formats by extension and tries everything else as text', () => {
    expect(chatFileKind('PHOTO.JPEG')).toBe('image')
    expect(chatFileKind('report.PDF')).toBe('pdf')
    expect(chatFileKind('report.docx')).toBe('docx')
    for (const name of ['code.ts', 'Dockerfile', 'image.svg', 'notes.adoc'])
      expect(chatFileKind(name)).toBe('text')
  })
  it('rejects binary content whatever the extension says', () => {
    expect(() =>
      textFileAttachment(new Uint8Array([77, 90, 0, 0]), 'app.exe')
    ).toThrow(new ChatFileError('unsupported'))
    expect(() =>
      textFileAttachment(new Uint8Array([80, 75, 3, 4, 200]), 'sheet.xlsx')
    ).toThrow(new ChatFileError('unsupported'))
  })
  it('recognizes files that usually hold secrets', () => {
    for (const name of ['.env', '.env.local', 'id_ed25519', 'server.pem'])
      expect(mayContainSecrets(name)).toBe(true)
    for (const name of ['env.ts', 'readme.md', 'keys.txt'])
      expect(mayContainSecrets(name)).toBe(false)
  })
  it('reads the error kind the Rust commands report', () => {
    expect(chatFileErrorKind({ kind: 'size', message: 'File too large' })).toBe(
      'size'
    )
    expect(chatFileErrorKind({ kind: 'memory', message: '' })).toBe('memory')
    expect(chatFileErrorKind({ kind: 'password' })).toBe('invalid')
    expect(chatFileErrorKind('size limit exceeded')).toBe('invalid')
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
    const notify = vi.fn()
    const prepare = vi.fn(async (entry: File) => {
      if (entry.name === 'bad.pdf') throw new ChatFileError('password')
      if (entry.name === 'app.exe') throw new ChatFileError('unsupported')
      return {
        attachments: [{ text: entry.name }],
        images: [],
        notices: [{ kind: 'secrets' as const }],
      }
    })
    const input = createChatFileInput({
      prepare,
      accept,
      report,
      notify,
      imageCount: () => 0,
      fileCount: () => 0,
    })
    await input.add(
      [file('bad.pdf'), file('app.exe'), file('.env')],
      () => true
    )
    expect(report.mock.calls).toEqual([
      ['bad.pdf', 'password'],
      ['app.exe', 'unsupported'],
    ])
    expect(accept).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ attachments: [{ text: '.env' }] })
    )
    expect(notify).toHaveBeenCalledExactlyOnceWith('.env', { kind: 'secrets' })
  })
  it('rejects oversized files before the reader and bounds each queued batch', async () => {
    const prepare = vi.fn()
    const report = vi.fn()
    const input = createChatFileInput({
      prepare,
      accept: vi.fn(),
      report,
      notify: vi.fn(),
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
      notify: vi.fn(),
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
