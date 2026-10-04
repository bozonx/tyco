import type { ChatMessage } from '@tyco/shared'

export type EditorContextSource = 'selection' | 'editor'

export interface EditorContext {
  text: string
  /** The selection in the editor when there is one, its whole text otherwise */
  source: EditorContextSource
  /** The chat already got an earlier text from the editor */
  updated: boolean
}

export interface EditorContextInput {
  editorText: string
  selectedText: string
  /** Messages of the chat, with the attachments they were sent with */
  messages: ChatMessage[]
  /** Attachments added to the next message in other ways */
  pendingAttachments: string[]
  /** The editor text the user removed from this chat */
  dismissed: string | null
}

/**
 * What the editor offers to the next chat message. It follows the editor until
 * the message is sent, then becomes part of it; a text the chat has already
 * received is not offered again, so later messages go without it until the
 * editor text changes. A text the user removed is not offered again either
 */
export function resolveEditorContext(
  input: EditorContextInput
): EditorContext | null {
  const selection = input.selectedText.trim()
  const text = selection || input.editorText.trim()
  if (!text) return null

  const sent = input.messages.flatMap((message) => message.attachments ?? [])
  if (
    sent.includes(text) ||
    input.pendingAttachments.includes(text) ||
    input.dismissed === text
  ) {
    return null
  }

  return {
    text,
    source: selection ? 'selection' : 'editor',
    updated: sent.length > 0,
  }
}
