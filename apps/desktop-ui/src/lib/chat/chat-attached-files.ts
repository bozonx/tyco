import type {
  AiAttachedFile,
  ChatAttachment,
  ChatAttachmentFile,
  ChatMessage,
} from '@tyco/shared'

import type { PreparedChatFile } from './chat-file-input'

/**
 * The originals of the files attached to a conversation: kept with it, named
 * for the model under `attachments/`. See `dev_docs/chat-files.md`
 */

type PrepareChatFile = (
  file: File,
  maxImageCount: number,
  isCurrent: () => boolean
) => Promise<PreparedChatFile>

export const ATTACHMENTS_ROOT = 'attachments'

/** The ids of the originals the attachments refer to */
export const attachmentFileIds = (attachments: ChatAttachment[] = []) =>
  attachments.flatMap((attachment) =>
    attachment.file ? [attachment.file.id] : []
  )

/** The ids of the images and originals the messages refer to */
export const messageFileIds = (messages: ChatMessage[]) =>
  messages.flatMap((message) => [
    ...(message.images || []).map((image) => image.id),
    ...attachmentFileIds(message.attachments),
  ])

/** `report (2).pdf` for the second `report.pdf` */
function numbered(name: string, index: number): string {
  const dot = name.lastIndexOf('.')
  return dot > 0
    ? `${name.slice(0, dot)} (${index})${name.slice(dot)}`
    : `${name} (${index})`
}

/** One plain file name, as the file tools accept it */
function plainName(name: string | undefined): string {
  const base = (name || '').split(/[\\/]/).at(-1) || ''
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '_').trim()
  return !cleaned || cleaned === '.' || cleaned === '..'
    ? 'file'
    : cleaned.slice(0, 200)
}

/**
 * The originals of the conversation in the order they were attached, each under
 * a name of its own: equal names get ` (2)`, ` (3)`. The same original attached
 * twice keeps its first name
 */
export function conversationAttachedFiles(
  attachments: readonly ChatAttachment[]
): AiAttachedFile[] {
  const files: AiAttachedFile[] = []
  const taken = new Set<string>()
  const seen = new Set<string>()
  for (const attachment of attachments) {
    const id = attachment.file?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const base = plainName(attachment.name)
    let name = base
    for (let index = 2; taken.has(name.toLowerCase()); index++)
      name = numbered(base, index)
    taken.add(name.toLowerCase())
    files.push({ name, id })
  }
  return files
}

/** The model path of an attachment; undefined for one without an original */
export function attachmentPath(
  attachment: ChatAttachment,
  files: readonly AiAttachedFile[]
): string | undefined {
  const id = attachment.file?.id
  const file = id && files.find((item) => item.id === id)
  return file ? `${ATTACHMENTS_ROOT}/${file.name}` : undefined
}

export interface KeptOriginalsDependencies {
  /** Keeps the original in the conversation's file store */
  storeFile: (file: File) => Promise<ChatAttachmentFile>
  warn: (message: string) => void
}

/**
 * Keeps the original of every file whose text is attached, whatever tools the
 * chat has: the model reads, pages and searches it under `attachments/`, and
 * the user can save it elsewhere. A file that cannot be kept is still attached
 * with its text
 */
export function withKeptOriginals(
  prepare: PrepareChatFile,
  deps: KeptOriginalsDependencies
): PrepareChatFile {
  return async (file, maxImageCount, isCurrent) => {
    const prepared = await prepare(file, maxImageCount, isCurrent)
    // images are kept by themselves, and a replaced draft keeps nothing
    if (!prepared.attachments.length || !isCurrent()) return prepared
    let kept: ChatAttachmentFile
    try {
      kept = await deps.storeFile(file)
    } catch (error) {
      deps.warn(`Could not keep the original of ${file.name}: ${String(error)}`)
      return prepared
    }
    return {
      ...prepared,
      attachments: prepared.attachments.map((attachment) => ({
        ...attachment,
        file: kept,
      })),
    }
  }
}
