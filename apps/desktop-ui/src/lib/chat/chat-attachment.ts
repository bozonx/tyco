import type { ChatAttachment, ChatAttachmentSource } from '@tyco/shared'

/** The i18n key of the label an attachment is shown with */
export function attachmentLabelKey(source?: ChatAttachmentSource): string {
  switch (source) {
    case 'selection':
      return 'chat.selectedText'
    case 'editor-selection':
      return 'chat.editorSelection'
    case 'editor-text':
      return 'chat.editorText'
    default:
      return 'chat.attachedText'
  }
}

export function attachmentIcon(
  source?: ChatAttachmentSource,
  mediaType?: string
): string {
  if (mediaType === 'application/pdf') return 'mdi:file-pdf-box'
  if (mediaType?.includes('wordprocessingml')) return 'mdi:file-word-outline'
  if (mediaType) return 'mdi:file-document-outline'
  switch (source) {
    case 'selection':
      return 'mdi:selection-drag'
    case 'editor-selection':
    case 'editor-text':
      return 'mdi:file-document-edit-outline'
    default:
      return 'mdi:text-box-outline'
  }
}

export interface AttachmentOrigins {
  /** The text selected in another application at the activation */
  externalSelection: string | null | undefined
  editorSelection: string
  editorText: string
}

/**
 * Where a text given to the chat by an action came from: the actions get only
 * the text, which is the editor selection, the editor text or the selection in
 * another application. Undefined when it is none of them
 */
export function inferAttachmentSource(
  text: string,
  origins: AttachmentOrigins
): ChatAttachmentSource | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  // a text taken into the editor from another application is still that
  // application's selection
  if (trimmed === origins.externalSelection?.trim()) return 'selection'
  if (trimmed === origins.editorSelection.trim()) return 'editor-selection'
  if (trimmed === origins.editorText.trim()) return 'editor-text'
  return undefined
}

const escapeAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

/**
 * The attachments as the model gets them, before the question. The text stays
 * as it is, readable and without escaping overhead; only a closing tag inside
 * it is broken, so an attachment cannot end early
 */
export function formatAttachmentsForPrompt(
  attachments: ChatAttachment[] = []
): string {
  return attachments
    .map(({ text, source, name, mediaType }) => {
      const attribute =
        (source ? ` source="${escapeAttribute(source)}"` : '') +
        (name ? ` name="${escapeAttribute(name)}"` : '') +
        (mediaType ? ` media-type="${escapeAttribute(mediaType)}"` : '')
      const body = text.replace(/<(\/attachment)/gi, '<\\$1')
      return `<attachment${attribute}>\n${body}\n</attachment>`
    })
    .join('\n\n')
}

const EXCERPT_LENGTH = 120
const TITLE_LENGTH = 400

/** The beginning of the text in one line: what it is about at a glance */
export function attachmentExcerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LENGTH)
}

/** A tooltip: what a click does, then the beginning of the text */
export function attachmentTitle(head: string, text: string): string {
  const trimmed = text.trim()
  const more = trimmed.length > TITLE_LENGTH ? '…' : ''
  return `${head}\n\n${trimmed.slice(0, TITLE_LENGTH)}${more}`
}

export const attachmentTexts = (attachments: ChatAttachment[] = []) =>
  attachments.map((attachment) => attachment.text)
