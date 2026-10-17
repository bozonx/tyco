import type { ChatImage } from '@tyco/shared'

import {
  chatFileKind,
  ChatFileError,
  mayContainSecrets,
  textFileAttachment,
  type PreparedChatFile,
} from './chat-file-input'
import { prepareChatImage, type PreparedChatImage } from './chat-image-input'

export interface ChatFileReaderDependencies {
  quality: () => 'economy' | 'balanced' | 'original'
  storeImage: (
    bytes: Uint8Array<ArrayBuffer>,
    name: string
  ) => Promise<ChatImage>
}

export function createChatFileReader(deps: ChatFileReaderDependencies) {
  return async (
    file: File,
    maxImageCount: number,
    isCurrent: () => boolean
  ): Promise<PreparedChatFile> => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const kind = chatFileKind(file.name, bytes, file.type)
    const result: PreparedChatFile = { attachments: [], images: [] }
    if (kind === 'text') {
      result.attachments.push(textFileAttachment(bytes, file.name))
      if (mayContainSecrets(file.name)) result.notices = [{ kind: 'secrets' }]
      return result
    }
    if (kind === 'docx') {
      const { readChatDocx } = await import('./chat-docx')
      result.attachments.push(readChatDocx(bytes, file.name))
      return result
    }
    let images = [file]
    if (kind === 'pdf') {
      const { readChatPdf } = await import('./chat-pdf')
      const pdf = await readChatPdf(bytes, file.name, maxImageCount, isCurrent)
      if (pdf.text) result.attachments.push(pdf.text)
      if (pdf.skippedPages)
        result.notices = [{ kind: 'pdfPagesSkipped', count: pdf.skippedPages }]
      images = pdf.pages
    }
    if (images.length > maxImageCount) throw new ChatFileError('imageLimit')
    // Normalize the entire file before accepting any part of it.
    for (const image of images) {
      if (!isCurrent()) return { attachments: [], images: [] }
      let prepared: PreparedChatImage
      try {
        prepared = await prepareChatImage(image, deps.quality())
      } catch (error) {
        throw error instanceof ChatFileError
          ? error
          : new ChatFileError('invalid')
      }
      if (!isCurrent()) return { attachments: [], images: [] }
      if (prepared.isAnimated)
        result.notices = [
          ...(result.notices || []),
          { kind: 'animatedFirstFrame' },
        ]
      result.images.push(await deps.storeImage(prepared.bytes, image.name))
    }
    return result
  }
}
