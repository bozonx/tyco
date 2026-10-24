import { ActivationMode, type DesktopViewState } from '@tyco/shared'

export type SelectionActivation = Pick<
  DesktopViewState,
  'activationId' | 'mode' | 'isWindowShown' | 'selectedText'
>

export interface CapturedSelectionDependencies {
  /** Puts the text into the editor instead of the current one. */
  replaceValue: (text: string) => void
  focus: () => void
  /** The text in the editor now. */
  getValue: () => string
}

/**
 * Takes the text selected in another app into the editor when the editor is
 * activated. The selection is captured asynchronously and arrives after the
 * activation itself, so it is taken at most once per activation, and not at all
 * once the user has edited the text meanwhile: the selection must not overwrite
 * what was typed while it was being captured.
 */
export function createCapturedSelection(deps: CapturedSelectionDependencies) {
  let lastAppliedActivation: number | undefined
  /** The editor text when the current activation was first seen. */
  let activationStart: { activationId: number; value: string } | undefined

  const apply = (params: SelectionActivation): boolean => {
    if (activationStart?.activationId !== params.activationId) {
      activationStart = {
        activationId: params.activationId,
        value: deps.getValue(),
      }
    }
    const text = params.selectedText ?? ''

    if (
      params.mode !== ActivationMode.EDITOR ||
      !params.isWindowShown ||
      !text.trim() ||
      params.activationId === lastAppliedActivation
    ) {
      return false
    }

    lastAppliedActivation = params.activationId
    if (deps.getValue() !== activationStart.value) return false
    deps.replaceValue(text)
    deps.focus()

    return true
  }

  return { apply }
}
