import { START_MODES, type InitParams } from '@tyco/shared'

export type SelectionActivation = Pick<
  InitParams,
  'activationId' | 'mode' | 'isWindowShown' | 'selectedText'
>

export interface CapturedSelectionDeps {
  /** Puts the text into the editor instead of the current one. */
  replaceValue: (text: string) => void
  focus: () => void
}

/**
 * Takes the text selected in another app into the editor when the editor is
 * activated. The selection is captured asynchronously and arrives after the
 * activation itself, so it is taken at most once per activation.
 */
export function createCapturedSelection(deps: CapturedSelectionDeps) {
  let lastAppliedActivation: number | undefined

  const apply = (params: SelectionActivation): boolean => {
    const text = params.selectedText ?? ''

    if (
      params.mode !== START_MODES.EDITOR ||
      !params.isWindowShown ||
      !text.trim() ||
      params.activationId === lastAppliedActivation
    ) {
      return false
    }

    lastAppliedActivation = params.activationId
    deps.replaceValue(text)
    deps.focus()

    return true
  }

  return { apply }
}
