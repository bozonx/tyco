/**
 * Where an attached text came from: `selection` was selected in another
 * application, the others come from the editor of the app
 */
export type ChatAttachmentSource =
  'selection' | 'editor-selection' | 'editor-text'

export interface ChatAttachment {
  text: string
  /** Unknown for attachments stored before the source was kept */
  source?: ChatAttachmentSource
  name?: string
  mediaType?: string
}

/**
 * A normalized image owned by the Rust chat image store; PNG only in chats
 * saved before WebP.
 */
export interface ChatImage {
  id: string
  mediaType: 'image/webp' | 'image/png'
  width: number
  height: number
  size: number
  name?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'developer'
  content: string
  images?: ChatImage[]
  attachments?: ChatAttachment[]
  status?: 'complete' | 'stopped'
}

export interface ChatParams {
  id?: string
  /** The title the chat has in the history */
  title?: string
  images?: ChatImage[]
  attachments?: ChatAttachment[]
}

export interface ChatSummary {
  id: string
  title: string
  lastMessageAt: string
}

export interface Chat extends ChatSummary {
  messages: ChatMessage[]
}

export interface OpenMainChatEvent {
  attachment?: ChatAttachment | null
  question?: string | null
  autoSend?: boolean
}

/** Rejects malformed externally delivered chat events before UI side effects. */
export function parseOpenMainChatEvent(value: unknown): OpenMainChatEvent {
  const record = (entry: unknown): entry is Record<string, unknown> =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !['attachment', 'question', 'autoSend'].includes(key)
    )
  )
    throw new Error('Invalid main chat event')
  if (value.question != null && typeof value.question !== 'string')
    throw new Error('Invalid chat question')
  if (value.autoSend !== undefined && typeof value.autoSend !== 'boolean')
    throw new Error('Invalid chat submit flag')
  if (value.attachment != null) {
    const attachment = value.attachment
    if (!record(attachment) || typeof attachment.text !== 'string')
      throw new Error('Invalid chat attachment')
    if (
      attachment.source !== undefined &&
      !['selection', 'editor-selection', 'editor-text'].includes(
        String(attachment.source)
      )
    )
      throw new Error('Invalid chat attachment source')
    for (const key of ['name', 'mediaType'])
      if (attachment[key] !== undefined && typeof attachment[key] !== 'string')
        throw new Error('Invalid chat attachment metadata')
  }
  return value as OpenMainChatEvent
}
