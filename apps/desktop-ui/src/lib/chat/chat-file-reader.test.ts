import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(async () => ({
    bytes: new Uint8Array([1]),
    isAnimated: false,
  })),
  pdf: vi.fn(),
}))
vi.mock('./chat-image-input', () => ({ prepareChatImage: mocks.prepare }))
vi.mock('./chat-pdf', () => ({ readChatPdf: mocks.pdf }))
import { createChatFileReader } from './chat-file-reader'

const image = {
  id: 'image',
  mediaType: 'image/webp' as const,
  width: 1,
  height: 1,
  size: 1,
}

describe('chat file reader', () => {
  it('uses configured quality and stores normalized image bytes', async () => {
    const storeImage = vi.fn(async () => image)
    const read = createChatFileReader({ quality: () => 'original', storeImage })
    const file = new File(['source'], 'a.png')
    expect(await read(file, 4, () => true)).toEqual({
      attachments: [],
      images: [image],
    })
    expect(mocks.prepare).toHaveBeenLastCalledWith(file, 'original')
    expect(storeImage).toHaveBeenCalledWith(new Uint8Array([1]), 'a.png')
  })
  it('preserves both extracted text and scans from a mixed PDF', async () => {
    const page = new File(['scan'], 'a.pdf — page 2.png')
    const text = {
      text: 'page one',
      name: 'a.pdf',
      mediaType: 'application/pdf',
    }
    mocks.pdf.mockResolvedValue({ text, pages: [page] })
    const read = createChatFileReader({
      quality: () => 'balanced',
      storeImage: async () => image,
    })
    expect(await read(new File(['pdf'], 'a.pdf'), 4, () => true)).toEqual({
      attachments: [text],
      images: [image],
    })
  })
  it('does not store an image after the draft was replaced during normalization', async () => {
    let current = true
    const storeImage = vi.fn()
    mocks.prepare.mockImplementationOnce(async () => {
      current = false
      return { bytes: new Uint8Array([1]), isAnimated: false }
    })
    const read = createChatFileReader({ quality: () => 'balanced', storeImage })
    expect(await read(new File(['source'], 'a.png'), 4, () => current)).toEqual(
      { attachments: [], images: [] }
    )
    expect(storeImage).not.toHaveBeenCalled()
  })
  it('tells that only the first frame of an animated image is attached', async () => {
    mocks.prepare.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      isAnimated: true,
    })
    const read = createChatFileReader({
      quality: () => 'balanced',
      storeImage: async () => image,
    })
    expect(await read(new File(['GIF89a'], 'a.gif'), 4, () => true)).toEqual({
      attachments: [],
      images: [image],
      notices: [{ kind: 'animatedFirstFrame' }],
    })
  })
})
