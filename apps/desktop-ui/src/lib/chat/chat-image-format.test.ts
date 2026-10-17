import { describe, expect, it } from 'vitest'

import { chatImageType, imageFormat } from './chat-image-format'

const encode = (text: string) => new TextEncoder().encode(text)

function concat(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0)
  )
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function png(width: number, height: number, chunks: string[] = []) {
  const header = new Uint8Array(33)
  header.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  const view = new DataView(header.buffer)
  view.setUint32(8, 13)
  header.set(encode('IHDR'), 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  // each extra chunk is empty: length, type and CRC
  const extra = chunks.map((type) =>
    concat(new Uint8Array(4), encode(type), new Uint8Array(4))
  )
  return concat(header, ...extra)
}

function gif(width: number, height: number, frames: number) {
  const header = concat(encode('GIF89a'), new Uint8Array(7))
  const view = new DataView(header.buffer)
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  // descriptor without a local color table, LZW code size, one data block
  const frame = concat(
    new Uint8Array([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0]),
    new Uint8Array([2, 1, 0, 0])
  )
  const comment = new Uint8Array([0x21, 0xfe, 2, 65, 66, 0])
  return concat(
    header,
    comment,
    ...Array(frames).fill(frame),
    new Uint8Array([0x3b])
  )
}

function bmp(width: number, height: number) {
  const bytes = new Uint8Array(54)
  bytes.set(encode('BM'), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  return bytes
}

function tiff(width: number, height: number, little = true) {
  const bytes = new Uint8Array(8 + 2 + 2 * 12)
  bytes.set(encode(little ? 'II*\0' : 'MM\0*'), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 8, little)
  view.setUint16(8, 2, little)
  // width as SHORT, height as LONG
  view.setUint16(10, 256, little)
  view.setUint16(12, 3, little)
  view.setUint32(14, 1, little)
  view.setUint16(18, width, little)
  view.setUint16(22, 257, little)
  view.setUint16(24, 4, little)
  view.setUint32(26, 1, little)
  view.setUint32(30, height, little)
  return bytes
}

function box(type: string, ...content: Uint8Array[]) {
  const body = concat(...content)
  const bytes = concat(new Uint8Array(4), encode(type), body)
  new DataView(bytes.buffer).setUint32(0, bytes.length)
  return bytes
}

function ispe(width: number, height: number) {
  const content = new Uint8Array(12)
  const view = new DataView(content.buffer)
  view.setUint32(4, width)
  view.setUint32(8, height)
  return box('ispe', content)
}

function heif(brand: string, sizes: [number, number][]) {
  return concat(
    box('ftyp', encode(brand), new Uint8Array(4), encode('mif1')),
    box(
      'meta',
      new Uint8Array(4),
      box('hdlr', new Uint8Array(8)),
      box('iprp', box('ipco', ...sizes.map(([w, h]) => ispe(w, h))))
    )
  )
}

describe('chat image format', () => {
  it('rejects huge dimensions before decoding pixels', () => {
    expect(imageFormat(png(1920, 1080))).toEqual({
      type: 'image/png',
      width: 1920,
      height: 1080,
      isAnimated: false,
    })
    expect(() => imageFormat(png(8000, 8000))).toThrow()
    expect(() => imageFormat(encode('<svg/>'))).toThrow()
  })

  it('marks animated PNG instead of rejecting it', () => {
    expect(imageFormat(png(10, 10, ['acTL', 'IDAT'])).isAnimated).toBe(true)
    expect(imageFormat(png(10, 10, ['IDAT', 'acTL'])).isAnimated).toBe(false)
  })

  it('accepts the dimensions of minimal lossless WebP files', () => {
    const bytes = new Uint8Array(26)
    bytes.set(encode('RIFF'), 0)
    bytes.set(encode('WEBPVP8L'), 8)
    bytes[20] = 47
    expect(imageFormat(bytes)).toEqual({
      type: 'image/webp',
      width: 1,
      height: 1,
      isAnimated: false,
    })
  })

  it('reads JPEG sizes from any frame type, progressive or lossless', () => {
    for (const marker of [0xc0, 0xc2, 0xc3, 0xc9]) {
      const bytes = new Uint8Array([
        0xff,
        0xd8,
        0xff,
        marker,
        0,
        11,
        8,
        0,
        20,
        0,
        30,
        1,
        1,
        0x11,
        0,
      ])
      expect(imageFormat(bytes)).toMatchObject({
        type: 'image/jpeg',
        width: 30,
        height: 20,
      })
    }
  })

  it('reads GIF sizes and counts frames', () => {
    expect(imageFormat(gif(64, 32, 1))).toEqual({
      type: 'image/gif',
      width: 64,
      height: 32,
      isAnimated: false,
    })
    expect(imageFormat(gif(64, 32, 3)).isAnimated).toBe(true)
  })

  it('reads BMP sizes, also of top-down rows', () => {
    expect(imageFormat(bmp(100, -50))).toMatchObject({
      type: 'image/bmp',
      width: 100,
      height: 50,
    })
  })

  it('reads TIFF sizes in both byte orders', () => {
    for (const little of [true, false])
      expect(imageFormat(tiff(300, 200, little))).toMatchObject({
        type: 'image/tiff',
        width: 300,
        height: 200,
      })
  })

  it('reads AVIF and HEIC sizes from the largest ispe property', () => {
    expect(
      imageFormat(
        heif('avif', [
          [512, 512],
          [4032, 3024],
        ])
      )
    ).toEqual({
      type: 'image/avif',
      width: 4032,
      height: 3024,
      isAnimated: false,
    })
    expect(imageFormat(heif('heic', [[4032, 3024]])).type).toBe('image/heic')
    expect(imageFormat(heif('avis', [[64, 64]])).isAnimated).toBe(true)
    expect(() => imageFormat(heif('heic', [[16_000, 16_000]]))).toThrow()
  })

  it('does not take other ISO media or text for images', () => {
    expect(
      chatImageType(
        box('ftyp', encode('isom'), new Uint8Array(4), encode('mp41'))
      )
    ).toBeNull()
    expect(chatImageType(encode('BMP is a format'))).toBeNull()
    expect(chatImageType(new Uint8Array())).toBeNull()
  })
})
