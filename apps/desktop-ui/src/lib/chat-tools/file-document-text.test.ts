import { describe, expect, it, vi } from 'vitest'
import { ChatFileError } from '../chat/chat-file-error'
import { readDocumentText } from './file-document-text'

vi.mock('../chat/chat-pdf', () => ({ readChatPdf: vi.fn() }))

vi.mock('../chat/chat-docx', () => ({ readChatDocx: vi.fn() }))

describe('readDocumentText', () => {
  it('reads text from a PDF file', async () => {
    const { readChatPdf } = await import('../chat/chat-pdf')
    vi.mocked(readChatPdf).mockResolvedValueOnce({
      text: { text: 'Hello PDF world' },
      pages: [],
    })

    const bytes = new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>
    const text = await readDocumentText(
      bytes,
      '/path/to/doc.pdf',
      'application/pdf'
    )

    expect(text).toBe('Hello PDF world')
    expect(readChatPdf).toHaveBeenCalledWith(
      bytes,
      'doc.pdf',
      0,
      expect.any(Function)
    )
  })

  it('reads text from a DOCX file', async () => {
    const { readChatDocx } = await import('../chat/chat-docx')
    vi.mocked(readChatDocx).mockReturnValueOnce({
      name: 'file.docx',
      text: 'Hello DOCX content',
    })

    const bytes = new Uint8Array([4, 5, 6]) as Uint8Array<ArrayBuffer>
    const text = await readDocumentText(
      bytes,
      '/path/to/file.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )

    expect(text).toBe('Hello DOCX content')
    expect(readChatDocx).toHaveBeenCalledWith(bytes, 'file.docx')
  })

  it('throws when document has no text or is whitespace only', async () => {
    const { readChatPdf } = await import('../chat/chat-pdf')
    vi.mocked(readChatPdf).mockResolvedValueOnce({
      text: { text: '   \n  ' },
      pages: [],
    })

    const bytes = new Uint8Array() as Uint8Array<ArrayBuffer>
    await expect(
      readDocumentText(bytes, '/tmp/scanned.pdf', 'application/pdf')
    ).rejects.toThrow(
      '/tmp/scanned.pdf has no text to read; it may be a scanned document'
    )
  })

  it('handles empty ChatFileError and reports scanned document message', async () => {
    const { readChatPdf } = await import('../chat/chat-pdf')
    vi.mocked(readChatPdf).mockRejectedValueOnce(new ChatFileError('empty'))

    const bytes = new Uint8Array() as Uint8Array<ArrayBuffer>
    await expect(
      readDocumentText(bytes, 'empty.pdf', 'application/pdf')
    ).rejects.toThrow(
      'empty.pdf has no text to read; it may be a scanned document'
    )
  })

  it('formats ChatFileError with kind in error message', async () => {
    const { readChatPdf } = await import('../chat/chat-pdf')
    vi.mocked(readChatPdf).mockRejectedValueOnce(
      new ChatFileError('unsupported')
    )

    const bytes = new Uint8Array() as Uint8Array<ArrayBuffer>
    await expect(
      readDocumentText(bytes, 'corrupt.pdf', 'application/pdf')
    ).rejects.toThrow('Could not read the text of corrupt.pdf (unsupported)')
  })

  it('wraps generic errors when reading fails', async () => {
    const { readChatDocx } = await import('../chat/chat-docx')
    vi.mocked(readChatDocx).mockImplementationOnce(() => {
      throw new Error('Decompression failed')
    })

    const bytes = new Uint8Array([1]) as Uint8Array<ArrayBuffer>
    await expect(
      readDocumentText(bytes, 'bad.docx', 'application/docx')
    ).rejects.toThrow('Could not read the text of bad.docx')
  })
})
