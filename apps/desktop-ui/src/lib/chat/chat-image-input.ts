import {
  MAX_CHAT_IMAGE_SOURCE_BYTES as MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_DIMENSION as MAX_OUTPUT_DIMENSION,
  type ChatImage,
} from '@tyco/shared'

import { ESTIMATED_CHARACTERS_PER_TOKEN } from '../llm/token-estimate'
import { ChatFileError } from './chat-file-error'
import {
  imageFormat,
  isWithinImageLimits,
  PLATFORM_IMAGE_TYPES,
} from './chat-image-format'

export { MAX_CHAT_IMAGES_COUNT } from '@tyco/shared'

/** A picked or pasted image file, before it is converted */
const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024
/** The longest side of an image sent at the economy and balanced qualities */
const ECONOMY_IMAGE_DIMENSION = 1024
const BALANCED_IMAGE_DIMENSION = 1568
/**
 * The context an image takes, estimated conservatively: tiles of this size,
 * each worth some tokens, plus a fixed part, and never less than the minimum.
 * Provider-specific estimates can replace it.
 */
const IMAGE_TILE_PX = 512
const IMAGE_TILE_TOKENS = 256
const IMAGE_BASE_TOKENS = 256
const MIN_IMAGE_TOKENS = 4096
export function imageBudgetCharacters(
  image: Pick<ChatImage, 'width' | 'height'>
): number {
  const tiles =
    Math.ceil(image.width / IMAGE_TILE_PX) *
    Math.ceil(image.height / IMAGE_TILE_PX)
  const tokens = Math.max(
    MIN_IMAGE_TOKENS,
    tiles * IMAGE_TILE_TOKENS + IMAGE_BASE_TOKENS
  )
  return tokens * ESTIMATED_CHARACTERS_PER_TOKEN
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
        ? ECONOMY_IMAGE_DIMENSION
        : quality === 'original'
          ? MAX_OUTPUT_DIMENSION
          : BALANCED_IMAGE_DIMENSION) /
        Math.max(image.naturalWidth, image.naturalHeight)
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
