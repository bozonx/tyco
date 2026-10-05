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
  /** Opens a new empty chat that takes nothing from the editor */
  startCleanChat: () => Promise<void>
  closeAllModals: () => void
  /** Opens the voice input whose result is sent to the chat right away */
  openQuickVoiceInput: () => void
  /** Finishes the open voice input and sends its result */
  submitVoiceInput: () => void
  /** Adds the text selected elsewhere to the next chat message */
  attachSelection: (text: string) => void
}

/**
 * The voice chat hotkey: the first press opens a voice input into the chat, a
 * press during the dictation finishes it and sends the result. Each activation
 * is handled once.
 *
 * A question asked from another application goes to a new empty chat, with only
 * the text selected there as its context; one asked while the chat is in view
 * follows up on it. The selection is captured asynchronously and may arrive
 * after the activation, so it is attached at most once, and only to a dictation
 * that the activation opened.
 */
export function createVoiceChatActivation(deps: VoiceChatActivationDeps) {
  let lastAppliedActivation: number | undefined
  let dictationActivation: number | undefined
  let currentActivation: number | undefined
  let windowWasShown = false
  let shownBeforeActivation = false
  /** The latest selection captured for the current activation */
  let latestSelection: string | null | undefined

  const attachSelection = (activationId: number) => {
    const text = latestSelection?.trim()
    if (!text || activationId !== dictationActivation) return
    dictationActivation = undefined
    deps.attachSelection(text)
  }

  const apply = async (params: VoiceChatActivationParams): Promise<boolean> => {
    if (params.activationId !== currentActivation) {
      currentActivation = params.activationId
      shownBeforeActivation = windowWasShown
    }
    windowWasShown = params.isWindowShown
    latestSelection = params.selectedText

    if (params.mode !== START_MODES.VOICE_CHAT || !params.isWindowShown) {
      return false
    }
    if (params.activationId === lastAppliedActivation) {
      attachSelection(params.activationId)
      return false
    }

    lastAppliedActivation = params.activationId
    dictationActivation = undefined
    const isInChat = deps.currentPath() === APP_ROUTES.CHAT.path

    if (isInChat && deps.isVoiceInputOpen()) {
      deps.submitVoiceInput()
      return true
    }

    // a dictation or a menu left on another screen must not outlive the switch
    deps.closeAllModals()
    if (!(isInChat && shownBeforeActivation)) await deps.startCleanChat()
    // a selection arriving before the new chat is there would go to the old one
    dictationActivation = params.activationId
    attachSelection(params.activationId)
    deps.openQuickVoiceInput()

    return true
  }

  return { apply }
}
