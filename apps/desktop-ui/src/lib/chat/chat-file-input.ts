import type { ChatAttachment, ChatImage } from '@tyco/shared'

import {
  ChatFileError,
  chatFileErrorKind,
  type ChatFileErrorKind,
  type ChatFileNotice,
} from './chat-file-error'
import { MAX_CHAT_IMAGES } from './chat-image-input'

export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024
export const MAX_CHAT_FILE_CHARACTERS = 500_000
const MAX_CHAT_FILES = 16
export { ChatFileError, type ChatFileErrorKind } from './chat-file-error'

export interface PreparedChatFile {
  attachments: ChatAttachment[]
  images: ChatImage[]
  notices?: ChatFileNotice[]
}

/**
 * Any other file is tried as text: the content, not the extension, tells a text
 * file from a binary one.
 */
export function chatFileKind(name: string): 'image' | 'text' | 'pdf' | 'docx' {
  const extension = name.split('.').at(-1)?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'image'
  if (extension === 'pdf' || extension === 'docx') return extension
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
      bytes[0] === 255 && bytes[1] === 254
        ? 'utf-16le'
        : bytes[0] === 254 && bytes[1] === 255
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
        if (files.length > MAX_CHAT_FILES && isCurrent())
          deps.report(files[MAX_CHAT_FILES].name, 'fileLimit')
        for (const file of files.slice(0, MAX_CHAT_FILES)) {
          if (!isCurrent()) return
          try {
            validateChatFile(file)
            if (deps.fileCount() >= MAX_CHAT_FILES)
              throw new ChatFileError('fileLimit')
            const prepared = await deps.prepare(
              file,
              MAX_CHAT_IMAGES - deps.imageCount(),
              isCurrent
            )
            if (!isCurrent()) return
            if (deps.imageCount() + prepared.images.length > MAX_CHAT_IMAGES)
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
  if (paths.length > MAX_CHAT_FILES && isCurrent())
    deps.report(
      paths[MAX_CHAT_FILES].split(/[\\/]/).at(-1) || paths[MAX_CHAT_FILES],
      'fileLimit'
    )
  for (const path of paths.slice(0, MAX_CHAT_FILES)) {
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
