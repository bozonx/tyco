import { describe, expect, it, vi } from 'vitest'
import type { ChatImage } from '@tyco/shared'
import { createChatImageInput, imageDimensions } from './chat-image-input'

const image: ChatImage = {
  id: 'image',
  mediaType: 'image/png',
  width: 1,
  height: 1,
  size: 4,
}
function png(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.set([73, 72, 68, 82], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

describe('chat image input', () => {
  it('rejects huge dimensions before decoding pixels', () => {
    expect(imageDimensions(png(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
      type: 'image/png',
    })
    expect(() => imageDimensions(png(8000, 8000))).toThrow()
    expect(() => imageDimensions(new TextEncoder().encode('<svg/>'))).toThrow()
  })

  it('does not attach an import to a replaced draft', async () => {
    let finish!: (bytes: Uint8Array<ArrayBuffer>) => void
    let current = true
    const store = vi.fn(async () => image)
    const accept = vi.fn()
    const input = createChatImageInput({
      prepare: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      store,
    })
    const pending = input.add([new File(['x'], 'x.png')], accept, () => current)
    await Promise.resolve()
    current = false
    finish(new Uint8Array([1]))
    await pending
    expect(store).not.toHaveBeenCalled()
    expect(accept).not.toHaveBeenCalled()
  })

  it('preserves file order and recovers after a failed import', async () => {
    const names: string[] = []
    const prepare = vi
      .fn()
      .mockRejectedValueOnce(new Error('Invalid image'))
      .mockResolvedValue(new Uint8Array([1]))
    const input = createChatImageInput({
      prepare,
      store: async (_, name) => {
        names.push(name)
        return image
      },
    })
    await expect(
      input.add(
        [new File([], 'bad')],
        () => {},
        () => true
      )
    ).rejects.toThrow()
    await input.add(
      [new File([], 'first'), new File([], 'second')],
      () => {},
      () => true
    )
    expect(names).toEqual(['first', 'second'])
  })
})
