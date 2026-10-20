import type { ChatImage } from '@tyco/shared'

import { ChatFileError } from './chat-file-error'
import {
  imageFormat,
  isWithinImageLimits,
  PLATFORM_IMAGE_TYPES,
} from './chat-image-format'

/** Mirrored by `MAX_MESSAGE_IMAGES` in `src-tauri/src/services/chat_images.rs` */
export const MAX_CHAT_IMAGES_COUNT = 4
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
export interface PreparedChatImage {
  /** Lossless PNG, the first frame of an animated image */
  bytes: Uint8Array<ArrayBuffer>
  isAnimated: boolean
}

export async function prepareChatImage(
  file: File,
  quality: 'economy' | 'balanced' | 'original' = 'balanced'
): Promise<PreparedChatImage> {
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES)
    throw new ChatFileError('size')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const format = imageFormat(bytes)
  const blob = new Blob([bytes], { type: format.type })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    try {
      await image.decode()
    } catch (error) {
      // a valid header the system decoder still cannot read
      if (PLATFORM_IMAGE_TYPES.has(format.type))
        throw new ChatFileError('imageFormat')
      throw error
    }
    if (!isWithinImageLimits(image.naturalWidth, image.naturalHeight))
      throw new Error('Image dimensions limit exceeded')
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
    // an image outside the document is drawn at its first frame
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const normalized = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Image encoding failed')),
        'image/png'
      )
    )
    if (normalized.size > MAX_CHAT_IMAGE_BYTES) throw new ChatFileError('size')
    return {
      bytes: new Uint8Array(await normalized.arrayBuffer()),
      isAnimated: format.isAnimated,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
