import {
  MAX_CHAT_FILE_BYTES,
  type ChatAttachment,
  type ChatImage,
} from '@tyco/shared'

import {
  ChatFileError,
  chatFileErrorKind,
  type ChatFileErrorKind,
  type ChatFileNotice,
} from './chat-file-error'
import { chatImageType } from './chat-image-format'
import { MAX_CHAT_IMAGES_COUNT } from './chat-image-input'

export { MAX_CHAT_FILE_BYTES } from '@tyco/shared'

export const MAX_CHAT_FILE_CHARACTERS = 500_000
const MAX_CHAT_FILES_COUNT = 16
export { ChatFileError, type ChatFileErrorKind } from './chat-file-error'

export interface PreparedChatFile {
  attachments: ChatAttachment[]
  images: ChatImage[]
  notices?: ChatFileNotice[]
}

const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'avif',
  'heic',
  'heif',
]

/**
 * The content decides first: a pasted file may have no extension, and a renamed
 * one keeps its bytes. The name and media type only route files whose bytes are
 * not recognised, so a broken image is reported as one. Any other file is tried
 * as text: the content, not the extension, tells a text file from a binary
 * one.
 */
export function chatFileKind(
  name: string,
  bytes: Uint8Array = new Uint8Array(),
  mediaType = ''
): 'image' | 'text' | 'pdf' | 'docx' {
  if (chatImageType(bytes)) return 'image'
  if (String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-') return 'pdf'
  const extension = name.includes('.')
    ? name.split('.').at(-1)?.toLowerCase() || ''
    : ''
  // SVG is XML text, attached as it is
  if (
    IMAGE_EXTENSIONS.includes(extension) ||
    (mediaType.startsWith('image/') && mediaType !== 'image/svg+xml')
  )
    return 'image'
  if (extension === 'pdf' || mediaType === 'application/pdf') return 'pdf'
  if (extension === 'docx' || mediaType.includes('wordprocessingml'))
    return 'docx'
  return 'text'
}

const SECRET_FILE =
  /^(\.env(\..+)?|\.npmrc|\.netrc|\.pgpass|id_(rsa|dsa|ecdsa|ed25519)|credentials(\..+)?|.+\.(pem|key|p12|pfx))$/i

/** Files that usually hold passwords or keys; the user is warned, not blocked */
export function mayContainSecrets(name: string): boolean {
  return SECRET_FILE.test(name)
}

function validateChatFile(file: File) {
  if (!file.size) throw new ChatFileError('empty')
  if (file.size > MAX_CHAT_FILE_BYTES) throw new ChatFileError('size')
}

export function textFileAttachment(
  bytes: Uint8Array,
  name: string,
  mediaType = 'text/plain'
): ChatAttachment {
  let text: string
  try {
    // A BOM selects UTF-16; otherwise require valid UTF-8 instead of corrupting text.
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : 'utf-8'
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    // binary formats are not valid UTF-8
    throw new ChatFileError('unsupported')
  }
  if (text.includes('\0')) throw new ChatFileError('unsupported')
  return extractedTextAttachment(text, name, mediaType)
}

export function extractedTextAttachment(
  text: string,
  name: string,
  mediaType: string
): ChatAttachment {
  if (!text.trim()) throw new ChatFileError('empty')
  if (text.length > MAX_CHAT_FILE_CHARACTERS)
    throw new ChatFileError('textLimit')
  return { text: text.trim(), name: name.slice(0, 255), mediaType }
}

export interface ChatFileInputDependencies {
  prepare: (
    file: File,
    maxImageCount: number,
    isCurrent: () => boolean
  ) => Promise<PreparedChatFile>
  accept: (prepared: PreparedChatFile) => void
  imageCount: () => number
  fileCount: () => number
  report: (file: string, error: ChatFileErrorKind) => void
  notify: (file: string, notice: ChatFileNotice) => void
}

/**
 * One failed file does not discard later files; replaced drafts receive
 * nothing.
 */
export function createChatFileInput(deps: ChatFileInputDependencies) {
  let queue = Promise.resolve()
  return {
    add(files: File[], isCurrent: () => boolean): Promise<void> {
      const task = queue.then(async () => {
        if (files.length > MAX_CHAT_FILES_COUNT && isCurrent())
          deps.report(files[MAX_CHAT_FILES_COUNT].name, 'fileLimit')
        for (const file of files.slice(0, MAX_CHAT_FILES_COUNT)) {
          if (!isCurrent()) return
          try {
            validateChatFile(file)
            if (deps.fileCount() >= MAX_CHAT_FILES_COUNT)
              throw new ChatFileError('fileLimit')
            const prepared = await deps.prepare(
              file,
              MAX_CHAT_IMAGES_COUNT - deps.imageCount(),
              isCurrent
            )
            if (!isCurrent()) return
            if (
              deps.imageCount() + prepared.images.length >
              MAX_CHAT_IMAGES_COUNT
            )
              throw new ChatFileError('imageLimit')
            deps.accept(prepared)
            for (const notice of prepared.notices || [])
              deps.notify(file.name, notice)
          } catch (error) {
            if (isCurrent()) deps.report(file.name, chatFileErrorKind(error))
          }
        }
      })
      queue = task.catch(() => undefined)
      return task
    },
  }
}

export interface ChatFileDropDependencies {
  read: (path: string) => Promise<File>
  accept: (files: File[]) => Promise<void>
  report: (name: string, kind: ChatFileErrorKind) => void
}

/**
 * The draft is captured before disk IO, so a drop cannot land in a different
 * chat.
 */
export async function importDroppedChatFiles(
  paths: string[],
  deps: ChatFileDropDependencies,
  isCurrent: () => boolean
) {
  if (paths.length > MAX_CHAT_FILES_COUNT && isCurrent())
    deps.report(
      paths[MAX_CHAT_FILES_COUNT].split(/[\\/]/).at(-1) ||
        paths[MAX_CHAT_FILES_COUNT],
      'fileLimit'
    )
  for (const path of paths.slice(0, MAX_CHAT_FILES_COUNT)) {
    if (!isCurrent()) return
    const name = path.split(/[\\/]/).at(-1) || path
    try {
      const file = await deps.read(path)
      if (!isCurrent()) return
      await deps.accept([file])
    } catch (error) {
      if (isCurrent()) deps.report(name, chatFileErrorKind(error))
    }
  }
}
