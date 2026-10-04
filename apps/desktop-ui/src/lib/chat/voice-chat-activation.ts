import { START_MODES, type InitParams } from '@tyco/shared'

import { APP_ROUTES, type AppRoutePath } from '../navigation/routes'

export type VoiceChatActivationParams = Pick<
  InitParams,
  'activationId' | 'mode' | 'isWindowShown'
> &
  Partial<Pick<InitParams, 'selectedText'>>

export interface VoiceChatActivationDeps {
  isVoiceInputOpen: () => boolean
  currentPath: () => AppRoutePath
  navigateTo: (path: AppRoutePath) => Promise<void>
  closeAllModals: () => void
  /** Opens the voice input whose result is sent to the chat right away */
  openQuickVoiceInput: () => void
  /** Finishes the open voice input and sends its result */
  submitVoiceInput: () => void
  /** Adds the text selected elsewhere to the next chat message */
  attachSelection: (text: string) => void
}

/**
 * The voice chat hotkey: the first press opens the current chat with a voice
 * input, a press during the dictation finishes it and sends the result. Each
 * activation is handled once. The text selected elsewhere becomes the context
 * of the question; it is captured asynchronously and may arrive after the
 * activation, so it is attached at most once, and only to a dictation that the
 * activation opened.
 */
export function createVoiceChatActivation(deps: VoiceChatActivationDeps) {
  let lastAppliedActivation: number | undefined
  let dictationActivation: number | undefined

  const attachSelection = (params: VoiceChatActivationParams) => {
    const text = params.selectedText?.trim()
    if (!text || params.activationId !== dictationActivation) return
    dictationActivation = undefined
    deps.attachSelection(text)
  }

  const apply = async (params: VoiceChatActivationParams): Promise<boolean> => {
    if (params.mode !== START_MODES.VOICE_CHAT || !params.isWindowShown) {
      return false
    }
    if (params.activationId === lastAppliedActivation) {
      attachSelection(params)
      return false
    }

    lastAppliedActivation = params.activationId
    dictationActivation = undefined
    const isInChat = deps.currentPath() === APP_ROUTES.CHAT.path

    if (isInChat && deps.isVoiceInputOpen()) {
      deps.submitVoiceInput()
      return true
    }

    dictationActivation = params.activationId
    // a dictation or a menu left on another screen must not outlive the switch
    deps.closeAllModals()
    if (!isInChat) await deps.navigateTo(APP_ROUTES.CHAT.path)
    attachSelection(params)
    deps.openQuickVoiceInput()

    return true
  }

  return { apply }
}
