import { START_MODES, type InitParams } from '@tyco/shared'

import { APP_ROUTES, type AppRoutePath } from '../navigation/routes'

export type VoiceChatActivationParams = Pick<
  InitParams,
  'activationId' | 'mode' | 'isWindowShown'
>

export interface VoiceChatActivationDeps {
  isVoiceInputOpen: () => boolean
  currentPath: () => AppRoutePath
  navigateTo: (path: AppRoutePath) => Promise<void>
  closeAllModals: () => void
  /** Opens the voice input whose result is sent to the chat right away */
  openQuickVoiceInput: () => void
  /** Finishes the open voice input and sends its result */
  submitVoiceInput: () => void
}

/**
 * The voice chat hotkey: the first press opens the current chat with a voice
 * input, a press during the dictation finishes it and sends the result. Each
 * activation is handled once.
 */
export function createVoiceChatActivation(deps: VoiceChatActivationDeps) {
  let lastAppliedActivation: number | undefined

  const apply = async (params: VoiceChatActivationParams): Promise<boolean> => {
    if (
      params.mode !== START_MODES.VOICE_CHAT ||
      !params.isWindowShown ||
      params.activationId === lastAppliedActivation
    ) {
      return false
    }

    lastAppliedActivation = params.activationId
    const isInChat = deps.currentPath() === APP_ROUTES.CHAT.path

    if (isInChat && deps.isVoiceInputOpen()) {
      deps.submitVoiceInput()
      return true
    }

    // a dictation or a menu left on another screen must not outlive the switch
    deps.closeAllModals()
    if (!isInChat) await deps.navigateTo(APP_ROUTES.CHAT.path)
    deps.openQuickVoiceInput()

    return true
  }

  return { apply }
}
