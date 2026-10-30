import type {
  VoiceFinishBehavior,
  VoiceFinishIntent,
} from '../lib/stt/voice-finish-intent'
import { useActionMenuStore } from '../stores/action-menu'
import { useChatScope } from './use-chat-scope'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'

/**
 * Voice input into the chat. The text goes to the caret of the chat input; the
 * quick variant, opened by the voice chat hotkey, sends it right away.
 */
export function useChatVoiceInput() {
  const { chat: chatStore, input: chatInputStore } = useChatScope()
  const actionMenuStore = useActionMenuStore()
  const menuModalsStore = useMenuModalsStore()

  const openChatVoiceInput = (options: {
    finishBehavior: VoiceFinishBehavior
  }) => {
    const value = chatInputStore.value
    const selection = chatInputStore.selection
    const start = Math.min(
      Math.max(selection?.start ?? value.length, 0),
      value.length
    )
    const end = Math.min(Math.max(selection?.end ?? start, start), value.length)
    const prefix = value.slice(0, start)
    const suffix = value.slice(end)

    menuModalsStore.nextModal(MenuModals.VOICE_RECOGNITION, {
      inline: true,
      chat: true,
      target: 'chat',
      prefix,
      suffix,
      finishBehavior: options.finishBehavior,
      onCorrected: (
        text: string,
        _recognizedText: string,
        _correctedText: string | undefined,
        intent: VoiceFinishIntent
      ) => {
        menuModalsStore.closeAll()
        if (intent === 'copy') {
          const copyAction = actionMenuStore
            .getDefaultActions()
            .find((action) => action.id === 'copyToClipboard')
          void copyAction?.action(text)
          return
        }
        chatInputStore.insertText(text)
        // during a reply the text stays in the input
        if (intent === 'submit') void chatStore.sendInput()
      },
    })
  }

  const isVoiceInputOpen = () =>
    menuModalsStore.currentModal === MenuModals.VOICE_RECOGNITION

  return { isVoiceInputOpen, openChatVoiceInput }
}
