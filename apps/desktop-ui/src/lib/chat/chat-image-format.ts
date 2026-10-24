import { MAX_CHAT_IMAGE_PIXELS } from '@tyco/shared'

/**
 * Image formats told by their bytes, not by the file name: pasted files often
 * have no extension, and a wrong one must not decide how a file is read.
 */
export type ChatImageType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'image/bmp'
  | 'image/tiff'
  | 'image/avif'
  | 'image/heic'

export interface ChatImageFormat {
  type: ChatImageType
  width: number
  height: number
  /** Only the first frame is attached */
  isAnimated: boolean
}

/**
 * Formats the webview may be unable to decode: WebKitGTK and WebView2 do not
 * read HEIC or TIFF, and AVIF depends on how the system WebKit was built.
 */
export const PLATFORM_IMAGE_TYPES: ReadonlySet<ChatImageType> = new Set([
  'image/tiff',
  'image/avif',
  'image/heic',
])

const MAX_SOURCE_PIXELS = MAX_CHAT_IMAGE_PIXELS
const MAX_SOURCE_DIMENSION = 16_384

const AVIF_BRANDS = new Set(['avif', 'avis'])
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
])
/** Brands of image sequences rather than still images */
const SEQUENCE_BRANDS = new Set(['avis', 'hevc', 'hevx', 'msf1'])

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length))

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function isoBrands(bytes: Uint8Array): string[] {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== 'ftyp') return []
  const size = Math.min(viewOf(bytes).getUint32(0), bytes.length)
  const brands = [ascii(bytes, 8, 4)]
  for (let offset = 16; offset + 4 <= size; offset += 4)
    brands.push(ascii(bytes, offset, 4))
  return brands
}

/** The image format by its signature, or null for anything else */
export function chatImageType(bytes: Uint8Array): ChatImageType | null {
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n')
    return 'image/png'
  if (
    bytes.length >= 3 &&
    bytes[0] === JPEG_MARKER_PREFIX &&
    bytes[1] === JPEG_START_OF_IMAGE
  )
    return 'image/jpeg'
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WEBP'
  )
    return 'image/webp'
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6)))
    return 'image/gif'
  if (bytes.length >= 26 && ascii(bytes, 0, 2) === 'BM') return 'image/bmp'
  if (
    bytes.length >= 8 &&
    (ascii(bytes, 0, 4) === 'II*\0' || ascii(bytes, 0, 4) === 'MM\0*')
  )
    return 'image/tiff'
  const brands = isoBrands(bytes)
  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'image/avif'
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) return 'image/heic'
  return null
}

interface Size {
  width: number
  height: number
  isAnimated?: boolean
}

function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null
  const view = viewOf(bytes)
  let isAnimated = false
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const chunk = ascii(bytes, offset + 4, 4)
    if (chunk === 'acTL') isAnimated = true
    if (chunk === 'IDAT' || length > bytes.length - offset - 12) break
    offset += length + 12
  }
  return { width: view.getUint32(16), height: view.getUint32(20), isAnimated }
}

/** JPEG markers are 0xFF followed by the marker code */
const JPEG_MARKER_PREFIX = 0xff
const JPEG_START_OF_IMAGE = 0xd8
const JPEG_END_OF_IMAGE = 0xd9
const JPEG_START_OF_SCAN = 0xda
/** Markers that stand alone, without a length: TEM and RST0–RST7 */
const JPEG_TEM = 0x01
const JPEG_RST_FIRST = 0xd0
const JPEG_RST_LAST = 0xd7
/** Every start-of-frame marker except DHT (C4), JPG (C8) and DAC (CC) */
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function jpegSize(bytes: Uint8Array): Size | null {
  const view = viewOf(bytes)
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== JPEG_MARKER_PREFIX) return null
    while (bytes[offset] === JPEG_MARKER_PREFIX) offset++
    const marker = bytes[offset++]
    if (marker === JPEG_END_OF_IMAGE || marker === JPEG_START_OF_SCAN)
      return null
    if (
      marker === JPEG_TEM ||
      (marker >= JPEG_RST_FIRST && marker <= JPEG_RST_LAST)
    )
      continue
    if (offset + 2 > bytes.length) return null
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) return null
    if (JPEG_FRAME_MARKERS.has(marker) && length >= 8)
      return {
        height: view.getUint16(offset + 3),
        width: view.getUint16(offset + 5),
      }
    offset += length
  }
  return null
}

/** The first byte of a lossless WebP bitstream */
const VP8L_SIGNATURE = 0x2f

function webpSize(bytes: Uint8Array): Size | null {
  const view = viewOf(bytes)
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X' && bytes.length >= 30)
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      isAnimated: Boolean(bytes[20] & 2),
    }
  if (
    chunk === 'VP8 ' &&
    bytes.length >= 30 &&
    // the start code of a VP8 key frame
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  )
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === VP8L_SIGNATURE) {
    const bits = view.getUint32(21, true)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  return null
}

/** Counts image descriptors; a second one makes the GIF animated. */
function gifSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 13) return null
  const view = viewOf(bytes)
  const skipSubBlocks = (offset: number) => {
    while (offset < bytes.length && bytes[offset]) offset += bytes[offset] + 1
    return offset + 1
  }
  const colorTable = (flags: number) =>
    flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0
  let frames = 0
  let offset = 13 + colorTable(bytes[10])
  while (offset < bytes.length && frames < 2) {
    const block = bytes[offset]
    if (block === 0x21) offset = skipSubBlocks(offset + 2)
    else if (block === 0x2c && offset + 10 <= bytes.length) {
      frames++
      offset = skipSubBlocks(offset + 11 + colorTable(bytes[offset + 9]))
    } else break
  }
  return {
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
    isAnimated: frames > 1,
  }
}

function bmpSize(bytes: Uint8Array): Size | null {
  const view = viewOf(bytes)
  // BITMAPCOREHEADER keeps 16-bit sizes; later headers keep signed 32-bit ones
  if (view.getUint32(14, true) === 12)
    return { width: view.getUint16(18, true), height: view.getUint16(20, true) }
  return {
    width: Math.abs(view.getInt32(18, true)),
    // a negative height stores the rows top-down
    height: Math.abs(view.getInt32(22, true)),
  }
}

/** Tags of the image size in a TIFF directory */
const TIFF_IMAGE_WIDTH_TAG = 0x0100
const TIFF_IMAGE_LENGTH_TAG = 0x0101

function tiffSize(bytes: Uint8Array): Size | null {
  const view = viewOf(bytes)
  const little = bytes[0] === 0x49
  const ifd = view.getUint32(4, little)
  if (ifd + 2 > bytes.length) return null
  const count = view.getUint16(ifd, little)
  let width = 0
  let height = 0
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > bytes.length) break
    const tag = view.getUint16(entry, little)
    const type = view.getUint16(entry + 2, little)
    // SHORT (3) or LONG (4), stored in the value field itself
    const value =
      type === 3
        ? view.getUint16(entry + 8, little)
        : type === 4
          ? view.getUint32(entry + 8, little)
          : 0
    if (tag === TIFF_IMAGE_WIDTH_TAG) width = value
    else if (tag === TIFF_IMAGE_LENGTH_TAG) height = value
  }
  return { width, height }
}

/** The child boxes of an ISO BMFF box, with their content ranges */
function* isoBoxes(bytes: Uint8Array, start: number, end: number) {
  const view = viewOf(bytes)
  let offset = start
  while (offset + 8 <= end) {
    let size = view.getUint32(offset)
    let header = 8
    if (size === 1) {
      if (offset + 16 > end) return
      size = Number(view.getBigUint64(offset + 8))
      header = 16
    } else if (size === 0) size = end - offset
    if (size < header || offset + size > end) return
    yield {
      type: ascii(bytes, offset + 4, 4),
      start: offset + header,
      end: offset + size,
    }
    offset += size
  }
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string) {
  for (const box of isoBoxes(bytes, start, end))
    if (box.type === type) return box
  return null
}

/**
 * HEIF keeps sizes in `ispe` properties: the largest one covers a grid image as
 * a whole, not only one of its tiles.
 */
function heifSize(bytes: Uint8Array): Size | null {
  const meta = findBox(bytes, 0, bytes.length, 'meta')
  // `meta` is a full box: version and flags come first
  const properties = meta && findBox(bytes, meta.start + 4, meta.end, 'iprp')
  const container =
    properties && findBox(bytes, properties.start, properties.end, 'ipco')
  if (!container) return null
  const view = viewOf(bytes)
  let size: Size | null = null
  for (const box of isoBoxes(bytes, container.start, container.end)) {
    if (box.type !== 'ispe' || box.start + 12 > box.end) continue
    const width = view.getUint32(box.start + 4)
    const height = view.getUint32(box.start + 8)
    if (!size || width * height > size.width * size.height)
      size = { width, height }
  }
  if (!size) return null
  return {
    ...size,
    isAnimated: isoBrands(bytes).some((brand) => SEQUENCE_BRANDS.has(brand)),
  }
}

const SIZE_READERS: Record<ChatImageType, (bytes: Uint8Array) => Size | null> =
  {
    'image/png': pngSize,
    'image/jpeg': jpegSize,
    'image/webp': webpSize,
    'image/gif': gifSize,
    'image/bmp': bmpSize,
    'image/tiff': tiffSize,
    'image/avif': heifSize,
    'image/heic': heifSize,
  }

/** Read dimensions before handing compressed bytes to a browser decoder. */
export function imageFormat(bytes: Uint8Array): ChatImageFormat {
  const type = chatImageType(bytes)
  const size = type && SIZE_READERS[type](bytes)
  if (
    !type ||
    !size ||
    !size.width ||
    !size.height ||
    size.width > MAX_SOURCE_DIMENSION ||
    size.height > MAX_SOURCE_DIMENSION ||
    size.width * size.height > MAX_SOURCE_PIXELS
  )
    throw new Error('Unsupported image or dimensions')
  return {
    type,
    width: size.width,
    height: size.height,
    isAnimated: Boolean(size.isAnimated),
  }
}

/** Whether decoded pixels stay within the limits the header promised */
export function isWithinImageLimits(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_SOURCE_DIMENSION &&
    height <= MAX_SOURCE_DIMENSION &&
    width * height <= MAX_SOURCE_PIXELS
  )
}
