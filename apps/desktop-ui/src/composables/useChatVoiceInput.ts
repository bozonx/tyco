import type { VoiceFinishIntent } from '../lib/stt/voice-finish-intent'
import { useChatStore } from '../stores/chat'
import { useChatInputStore } from '../stores/chatInput'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'

/**
 * Voice input into the chat. The text goes to the caret of the chat input; the
 * quick variant, opened by the voice chat hotkey, sends it right away.
 */
export function useChatVoiceInput() {
  const chatStore = useChatStore()
  const chatInputStore = useChatInputStore()
  const menuModalsStore = useMenuModalsStore()

  const openChatVoiceInput = (options: { quickSend: boolean }) => {
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
      prefix,
      suffix,
      quickSend: options.quickSend,
      onCorrected: (
        text: string,
        _recognizedText: string,
        _correctedText: string | undefined,
        intent: VoiceFinishIntent
      ) => {
        menuModalsStore.closeAll()
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
