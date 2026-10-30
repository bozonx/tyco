import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatFileError } from './chat-file-error'
import { imageFormat } from './chat-image-format'
import { imageBudgetCharacters, prepareChatImage } from './chat-image-input'

vi.mock(import('./chat-image-format'), async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, imageFormat: vi.fn(original.imageFormat) }
})

/** The header of a PNG of the given size; the rest is never read here */
function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function pngFile(width = 2000, height = 1000) {
  return new File([pngHeader(width, height)], 'image.png', {
    type: 'image/png',
  })
}

interface FakeImage {
  src: string
  naturalWidth: number
  naturalHeight: number
  decode: () => Promise<void>
}

describe('chat image input', () => {
  let decoded: { width: number; height: number; fails?: Error }
  let canvas: {
    width: number
    height: number
    getContext: ReturnType<typeof vi.fn>
    toBlob: ReturnType<typeof vi.fn>
  }
  const drawImage = vi.fn()
  const { createObjectURL, revokeObjectURL } = URL

  beforeEach(() => {
    decoded = { width: 2000, height: 1000 }
    vi.stubGlobal(
      'Image',
      class implements FakeImage {
        src = ''
        naturalWidth = 0
        naturalHeight = 0
        async decode() {
          if (decoded.fails) throw decoded.fails
          this.naturalWidth = decoded.width
          this.naturalHeight = decoded.height
        }
      }
    )
    canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((done: (blob: Blob | null) => void) =>
        done(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
      ),
    }
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas'
        ? (canvas as unknown as HTMLCanvasElement)
        : createElement(tag)
    )
    URL.createObjectURL = vi.fn(() => 'blob:image')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.mocked(imageFormat).mockReset()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
  })

  it('budgets large originals more conservatively than resized images', () => {
    expect(imageBudgetCharacters({ width: 1024, height: 1024 })).toBe(4096 * 3)
    expect(
      imageBudgetCharacters({ width: 6000, height: 4000 })
    ).toBeGreaterThan(4096 * 3)
  })

  it.each([
    ['economy', 1024, 512],
    ['balanced', 1568, 784],
    ['original', 2000, 1000],
  ] as const)(
    'scales a %s image to %ix%i and releases its URL',
    async (quality, width, height) => {
      const prepared = await prepareChatImage(pngFile(), quality)
      expect([canvas.width, canvas.height]).toEqual([width, height])
      expect(drawImage).toHaveBeenCalledWith(
        expect.anything(),
        0,
        0,
        width,
        height
      )
      expect(prepared).toEqual({
        bytes: new Uint8Array([1, 2, 3]),
        isAnimated: false,
      })
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image')
    }
  )

  it('rejects empty and oversized files before reading them', async () => {
    await expect(
      prepareChatImage(new File([], 'empty.png'))
    ).rejects.toMatchObject({ kind: 'size' })
    const huge = new File([new Uint8Array(1)], 'huge.png')
    Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 })
    await expect(prepareChatImage(huge)).rejects.toBeInstanceOf(ChatFileError)
  })

  it('explains platform formats the decoder cannot read', async () => {
    vi.mocked(imageFormat).mockReturnValueOnce({
      type: 'image/heic',
      width: 10,
      height: 10,
      isAnimated: false,
    })
    decoded.fails = new Error('Decode failed')
    await expect(prepareChatImage(pngFile())).rejects.toMatchObject({
      kind: 'imageFormat',
    })
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('passes decoder failures of common formats through', async () => {
    decoded.fails = new Error('Decode failed')
    await expect(prepareChatImage(pngFile())).rejects.toThrow('Decode failed')
  })

  it('rejects images whose decoded size exceeds the limits', async () => {
    decoded = { width: 20000, height: 10 }
    await expect(prepareChatImage(pngFile())).rejects.toThrow(
      'Image dimensions limit exceeded'
    )
  })

  it('fails without a canvas context or an encoded result', async () => {
    canvas.getContext.mockReturnValueOnce(null)
    await expect(prepareChatImage(pngFile())).rejects.toThrow(
      'Image processing is unavailable'
    )
    canvas.toBlob.mockImplementationOnce((done: (blob: null) => void) =>
      done(null)
    )
    await expect(prepareChatImage(pngFile())).rejects.toThrow(
      'Image encoding failed'
    )
  })

  it('rejects normalized images over the transfer limit', async () => {
    const large = new Blob([])
    Object.defineProperty(large, 'size', { value: 65 * 1024 * 1024 })
    canvas.toBlob.mockImplementationOnce((done: (blob: Blob) => void) =>
      done(large)
    )
    await expect(prepareChatImage(pngFile())).rejects.toMatchObject({
      kind: 'size',
    })
  })
})
