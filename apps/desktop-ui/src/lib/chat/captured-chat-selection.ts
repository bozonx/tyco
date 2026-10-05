import { START_MODES, type InitParams } from '@tyco/shared'

export type SelectionActivation = Pick<
  InitParams,
  'activationId' | 'mode' | 'isWindowShown' | 'selectedText'
>

export interface CapturedChatSelectionDeps {
  startChatWithAttachment: (attachment: string) => Promise<void> | void
  /** The selection in the editor of this window */
  getSelectedText?: () => string | undefined
}

/**
 * Takes the text selected elsewhere into the chat attachments when the chat is
 * activated. The selection is captured asynchronously and arrives after the
 * activation itself, so it is taken at most once per activation.
 *
 * Without a selection elsewhere, the one in the editor is taken, but only when
 * the window was already shown: the editor of a hidden window keeps the
 * selection of its last use, which has nothing to do with the question.
 */
export function createCapturedChatSelection(deps: CapturedChatSelectionDeps) {
  let lastAppliedActivation: number | undefined
  let currentActivation: number | undefined
  let windowWasShown = false
  let shownBeforeActivation = false

  const apply = (params: SelectionActivation): boolean => {
    if (params.activationId !== currentActivation) {
      currentActivation = params.activationId
      shownBeforeActivation = windowWasShown
    }
    windowWasShown = params.isWindowShown

    const editorText = shownBeforeActivation
      ? deps.getSelectedText?.()
      : undefined
    const text = (params.selectedText ?? editorText ?? '').trim()

    if (
      params.mode !== START_MODES.CHAT ||
      !params.isWindowShown ||
      !text ||
      params.activationId === lastAppliedActivation
    ) {
      return false
    }

    lastAppliedActivation = params.activationId
    void deps.startChatWithAttachment(text)

    return true
  }

  return { apply }
}
