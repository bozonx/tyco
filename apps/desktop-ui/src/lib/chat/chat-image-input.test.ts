import { describe, expect, it } from 'vitest'
import { imageDimensions, imageBudgetCharacters } from './chat-image-input'

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

  it('accepts the dimensions of minimal lossless WebP files', () => {
    const bytes = new Uint8Array(26)
    bytes.set(new TextEncoder().encode('RIFF'), 0)
    bytes.set(new TextEncoder().encode('WEBPVP8L'), 8)
    bytes[20] = 47
    expect(imageDimensions(bytes)).toEqual({
      width: 1,
      height: 1,
      type: 'image/webp',
    })
  })
  it('budgets large originals more conservatively than resized images', () => {
    expect(imageBudgetCharacters({ width: 1024, height: 1024 })).toBe(4096 * 3)
    expect(
      imageBudgetCharacters({ width: 6000, height: 4000 })
    ).toBeGreaterThan(4096 * 3)
  })
})
