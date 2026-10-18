import type { ChatAttachment } from '@tyco/shared'

/*
 * The chat takes nothing from the editor on its own: the editor text goes to it
 * only when the user sends it there, and then as a visible attachment. A
 * question asked by voice is the exception, see `resolveVoiceChatContext`
 */

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
    ? { text: selection, source: 'editorSelection' }
    : null
}
