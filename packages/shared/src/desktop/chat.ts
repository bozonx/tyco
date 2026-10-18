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
  /**
   * Where a file dropped into a profile chat is kept for the file tools, e.g.
   * `workspace/uploads/report.pdf`
   */
  workspacePath?: string
}

/**
 * A normalized image owned by the Rust chat image store; PNG only in chats
 * saved before WebP.
 */
export interface ChatImage {
  id: string
  mediaType: 'image/webp'
  width: number
  height: number
  size: number
  name?: string
}

/**
 * Where a tool call stands: running, waiting for the user's decision, not
 * allowed to run, finished, or failed
 */
export type ChatToolCallState =
  'pending' | 'awaiting-approval' | 'denied' | 'done' | 'error'

/** A source the answer drew on */
export interface ChatSource {
  url: string
  title?: string
  snippet?: string
}

/**
 * One piece of an assistant message, in the order it was produced. `content`
 * stays the answer's text; the parts add the reasoning and the tool steps
 */
export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      /**
       * How the chat names the tool: an i18n key of a core tool, or the text a
       * plugin or MCP server gave. The tool's name when neither is set
       */
      labelKey?: string
      label?: string
      /** An Iconify name, e.g. `mdi:clock-outline` */
      icon?: string
      input: unknown
      state: ChatToolCallState
      /** Set while the call waits for the user's decision */
      approvalId?: string
    }
  | {
      type: 'tool-result'
      toolCallId: string
      toolName: string
      /** What the model was given, already cut to the output limit */
      output: string
      isError?: boolean
      isTruncated?: boolean
    }
  | {
      type: 'file'
      /** The id of the file in the chat's storage; never the bytes */
      fileId: string
      mediaType: string
      name?: string
    }
  | { type: 'sources'; sources: ChatSource[] }

export interface ChatMessage {
  role: 'user' | 'assistant' | 'developer'
  content: string
  images?: ChatImage[]
  attachments?: ChatAttachment[]
  /** The steps of an answer that used tools; absent in plain answers */
  parts?: ChatMessagePart[]
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
  /** Unix time in milliseconds */
  lastMessageAt: number
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
