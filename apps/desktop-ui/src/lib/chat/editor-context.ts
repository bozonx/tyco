import type {
  ChatAttachment,
  ChatAttachmentSource,
  ChatMessage,
} from '@tyco/shared'

import { attachmentTexts } from './chat-attachment'

export type EditorContextSource = Extract<
  ChatAttachmentSource,
  'editor-selection' | 'editor-text'
>

/**
 * `attached` goes with the next message; `suggested` is only offered, the user
 * takes it with a click
 */
export type EditorContextMode = 'attached' | 'suggested'

export interface EditorContext {
  text: string
  /** The selection in the editor when there is one, its whole text otherwise */
  source: EditorContextSource
  /** The chat already got an earlier text from the editor */
  updated: boolean
  mode: EditorContextMode
}

export interface EditorContextInput {
  editorText: string
  selectedText: string
  /** Messages of the chat, with the attachments they were sent with */
  messages: ChatMessage[]
  /** Attachments added to the next message in other ways */
  pendingAttachments: ChatAttachment[]
  /** The editor text the user removed from this chat */
  dismissed: string | null
  /** The suggested text the user took into the next message */
  accepted: string | null
  /**
   * A selection made before the chat came into view: left from an earlier
   * showing of the window, or from before another chat was opened
   */
  staleSelection: string | null
}

/**
 * What the editor offers to the next chat message. Only a fresh selection in
 * the editor is attached on its own: the user picked it right before asking.
 * The whole editor text and an old selection are only suggested, since the
 * editor is not in view of the chat and may hold an unrelated draft.
 *
 * A text the chat has already received is not offered again, so later messages
 * go without it until the editor text changes. A text the user removed is not
 * offered again either
 */
export function resolveEditorContext(
  input: EditorContextInput
): EditorContext | null {
  const selection = input.selectedText.trim()
  const text = selection || input.editorText.trim()
  if (!text) return null

  const sent = input.messages.flatMap((message) =>
    attachmentTexts(message.attachments)
  )
  if (
    sent.includes(text) ||
    input.pendingAttachments.some((item) => item.text === text) ||
    input.dismissed === text
  ) {
    return null
  }

  const freshSelection =
    Boolean(selection) && selection !== input.staleSelection?.trim()

  return {
    text,
    source: selection ? 'editor-selection' : 'editor-text',
    updated: sent.length > 0,
    mode: freshSelection || input.accepted === text ? 'attached' : 'suggested',
  }
}

export interface VoiceChatContextInput {
  /** The text selected in another application when the hotkey was pressed */
  externalSelection: string | null | undefined
  editorSelection: string
  staleSelection: string | null
}

/**
 * What a question asked by voice is about: the text selected in another
 * application, otherwise a fresh selection in the editor. The whole editor text
 * never goes along: the question is sent without the user reviewing it
 */
export function resolveVoiceChatContext(
  input: VoiceChatContextInput
): ChatAttachment | null {
  const external = input.externalSelection?.trim()
  if (external) return { text: external, source: 'selection' }
  const selection = input.editorSelection.trim()
  return selection && selection !== input.staleSelection?.trim()
    ? { text: selection, source: 'editor-selection' }
    : null
}
