import type { ChatAttachment, ChatImage } from '@tyco/shared'

import { MAX_CHAT_IMAGES } from './chat-image-input'

export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024
export const MAX_CHAT_FILE_CHARACTERS = 500_000
export const MAX_CHAT_FILES = 16
export const TEXT_FILE_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'py',
  'rs',
  'go',
  'java',
  'kt',
  'kts',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'toml',
  'ini',
  'conf',
  'log',
  'tex',
  'r',
  'swift',
  'dart',
  'graphql',
  'proto',
])
export const CHAT_FILE_ACCEPT = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.pdf',
  '.docx',
  ...Array.from(TEXT_FILE_EXTENSIONS, (extension) => `.${extension}`),
].join(',')

export type ChatFileErrorKind =
  | 'unsupported'
  | 'size'
  | 'invalid'
  | 'empty'
  | 'textLimit'
  | 'imageLimit'
  | 'fileLimit'
  | 'pdfPages'
  | 'password'
  | 'memory'

export class ChatFileError extends Error {
  constructor(readonly kind: ChatFileErrorKind) {
    super(`Chat file import failed: ${kind}`)
  }
}

export interface PreparedChatFile {
  attachments: ChatAttachment[]
  images: ChatImage[]
}

export function chatFileKind(name: string): 'image' | 'text' | 'pdf' | 'docx' {
  const extension = name.split('.').at(-1)?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'image'
  if (extension === 'pdf' || extension === 'docx') return extension
  if (
    TEXT_FILE_EXTENSIONS.has(extension) ||
    ['Dockerfile', 'Makefile', '.gitignore', '.env'].includes(name)
  )
    return 'text'
  throw new ChatFileError('unsupported')
}

export function validateChatFile(file: File) {
  chatFileKind(file.name)
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
    throw new ChatFileError('invalid')
  }
  if (text.includes('\0')) throw new ChatFileError('invalid')
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

export interface ChatFileInputDeps {
  prepare: (
    file: File,
    availableImages: number,
    isCurrent: () => boolean
  ) => Promise<PreparedChatFile>
  accept: (prepared: PreparedChatFile) => void
  imageCount: () => number
  fileCount: () => number
  report: (file: string, error: ChatFileErrorKind) => void
}

/**
 * One failed file does not discard later files; replaced drafts receive
 * nothing.
 */
export function createChatFileInput(deps: ChatFileInputDeps) {
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
          } catch (error) {
            if (isCurrent())
              deps.report(
                file.name,
                error instanceof ChatFileError
                  ? error.kind
                  : String(error).includes('memory limit')
                    ? 'memory'
                    : 'invalid'
              )
          }
        }
      })
      queue = task.catch(() => undefined)
      return task
    },
  }
}

export interface ChatFileDropDeps {
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
  deps: ChatFileDropDeps,
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
      chatFileKind(name)
      const file = await deps.read(path)
      if (!isCurrent()) return
      await deps.accept([file])
    } catch (error) {
      if (isCurrent())
        deps.report(
          name,
          error instanceof ChatFileError
            ? error.kind
            : String(error).includes('size limit')
              ? 'size'
              : 'invalid'
        )
    }
  }
}
