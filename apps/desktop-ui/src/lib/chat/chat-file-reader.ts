import type { ChatImage } from '@tyco/shared'

import {
  chatFileKind,
  ChatFileError,
  mayContainSecrets,
  textFileAttachment,
  type PreparedChatFile,
} from './chat-file-input'
import { prepareChatImage } from './chat-image-input'

export interface ChatFileReaderDeps {
  quality: () => 'economy' | 'balanced' | 'original'
  storeImage: (
    bytes: Uint8Array<ArrayBuffer>,
    name: string
  ) => Promise<ChatImage>
}

export function createChatFileReader(deps: ChatFileReaderDeps) {
  return async (
    file: File,
    availableImages: number,
    isCurrent: () => boolean
  ): Promise<PreparedChatFile> => {
    const kind = chatFileKind(file.name)
    const result: PreparedChatFile = { attachments: [], images: [] }
    if (kind === 'text') {
      result.attachments.push(
        textFileAttachment(new Uint8Array(await file.arrayBuffer()), file.name)
      )
      if (mayContainSecrets(file.name)) result.notices = [{ kind: 'secrets' }]
      return result
    }
    if (kind === 'docx') {
      const { readChatDocx } = await import('./chat-docx')
      result.attachments.push(
        readChatDocx(new Uint8Array(await file.arrayBuffer()), file.name)
      )
      return result
    }
    let images = [file]
    if (kind === 'pdf') {
      const { readChatPdf } = await import('./chat-pdf')
      const pdf = await readChatPdf(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        availableImages,
        isCurrent
      )
      if (pdf.text) result.attachments.push(pdf.text)
      if (pdf.skippedPages)
        result.notices = [{ kind: 'pdfPagesSkipped', count: pdf.skippedPages }]
      images = pdf.pages
    }
    if (images.length > availableImages) throw new ChatFileError('imageLimit')
    // Normalize the entire file before accepting any part of it.
    for (const image of images) {
      if (!isCurrent()) return { attachments: [], images: [] }
      let bytes: Uint8Array<ArrayBuffer>
      try {
        bytes = await prepareChatImage(image, deps.quality())
      } catch (error) {
        throw error instanceof ChatFileError
          ? error
          : new ChatFileError('invalid')
      }
      if (!isCurrent()) return { attachments: [], images: [] }
      result.images.push(await deps.storeImage(bytes, image.name))
    }
    return result
  }
}
