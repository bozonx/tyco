import { START_MODES, type InitParams } from '@tyco/shared'

export type SelectionActivation = Pick<
  InitParams,
  'activationId' | 'mode' | 'isWindowShown' | 'selectedText'
>

export interface CapturedChatSelectionDeps {
  startChatWithAttachment: (attachment: string) => Promise<void> | void
  getSelectedText?: () => string | undefined
}

/**
 * Takes the text selected elsewhere into the chat attachments when the chat is
 * activated. The selection is captured asynchronously and arrives after the
 * activation itself, so it is taken at most once per activation.
 */
export function createCapturedChatSelection(deps: CapturedChatSelectionDeps) {
  let lastAppliedActivation: number | undefined

  const apply = (params: SelectionActivation): boolean => {
    const text = (params.selectedText ?? deps.getSelectedText?.() ?? '').trim()

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
