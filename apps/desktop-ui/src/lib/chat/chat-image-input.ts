import type { ChatImage } from '@tyco/shared'

import { ChatFileError } from './chat-file-error'

/** Mirrored by `MAX_MESSAGE_IMAGES` in `src-tauri/src/services/chat_images.rs` */
export const MAX_CHAT_IMAGES = 4
const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024
/**
 * The lossless PNG handed to Rust, which keeps it as a WebP; mirrors
 * `MAX_SOURCE_BYTES` there
 */
const MAX_CHAT_IMAGE_BYTES = 64 * 1024 * 1024
/** The largest side providers accept (Anthropic rejects anything above) */
const MAX_OUTPUT_DIMENSION = 8000
/** Conservative request allowance; provider-specific estimates can replace it. */
const IMAGE_BUDGET_CHARACTERS = 4096 * 3
export function imageBudgetCharacters(
  image: Pick<ChatImage, 'width' | 'height'>
): number {
  return Math.max(
    IMAGE_BUDGET_CHARACTERS,
    (Math.ceil(image.width / 512) * Math.ceil(image.height / 512) * 256 + 256) *
      3
  )
}
const MAX_SOURCE_PIXELS = 24_000_000
const MAX_SOURCE_DIMENSION = 16_384

/** Read dimensions before handing compressed bytes to a browser decoder. */
export function imageDimensions(bytes: Uint8Array): {
  width: number
  height: number
  type: string
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length))
  let width = 0
  let height = 0
  let type = ''
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    ascii(1, 7) === 'PNG\r\n\u001a\n' &&
    ascii(12, 4) === 'IHDR'
  ) {
    width = view.getUint32(16)
    height = view.getUint32(20)
    type = 'image/png'
    let offset = 8
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset)
      const chunk = ascii(offset + 4, 4)
      if (chunk === 'acTL') throw new Error('Animated images are not supported')
      if (chunk === 'IDAT') break
      if (length > bytes.length - offset - 12) break
      offset += length + 12
    }
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192, 193, 194].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3)
        width = view.getUint16(offset + 5)
        type = 'image/jpeg'
        break
      }
      offset += length
    }
  } else if (
    bytes.length >= 25 &&
    ascii(0, 4) === 'RIFF' &&
    ascii(8, 4) === 'WEBP'
  ) {
    const chunk = ascii(12, 4)
    if (chunk === 'VP8X' && bytes.length >= 30) {
      // Animated WebP is deliberately excluded from the first slice.
      if (bytes[20] & 2) throw new Error('Animated images are not supported')
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    } else if (
      chunk === 'VP8 ' &&
      bytes.length >= 30 &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    ) {
      width = view.getUint16(26, true) & 0x3fff
      height = view.getUint16(28, true) & 0x3fff
    } else if (chunk === 'VP8L' && bytes[20] === 47) {
      const bits = view.getUint32(21, true)
      width = (bits & 0x3fff) + 1
      height = ((bits >>> 14) & 0x3fff) + 1
    }
    type = 'image/webp'
  }
  if (
    !width ||
    !height ||
    width > MAX_SOURCE_DIMENSION ||
    height > MAX_SOURCE_DIMENSION ||
    width * height > MAX_SOURCE_PIXELS
  ) {
    throw new Error('Unsupported image or dimensions')
  }
  return { width, height, type }
}

export async function prepareChatImage(
  file: File,
  quality: 'economy' | 'balanced' | 'original' = 'balanced'
): Promise<Uint8Array<ArrayBuffer>> {
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES)
    throw new ChatFileError('size')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const dimensions = imageDimensions(bytes)
  const blob = new Blob([bytes], { type: dimensions.type })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth > MAX_SOURCE_DIMENSION ||
      image.naturalHeight > MAX_SOURCE_DIMENSION ||
      image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS
    ) {
      throw new Error('Image dimensions limit exceeded')
    }
    const scale = Math.min(
      1,
      (quality === 'economy'
        ? 1024
        : quality === 'original'
          ? MAX_OUTPUT_DIMENSION
          : 1568) / Math.max(image.naturalWidth, image.naturalHeight)
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image processing is unavailable')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const normalized = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Image encoding failed')),
        'image/png'
      )
    )
    if (normalized.size > MAX_CHAT_IMAGE_BYTES) throw new ChatFileError('size')
    return new Uint8Array(await normalized.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}
