import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatVoiceInput } from './useChatVoiceInput'
import { MenuModals } from '../stores/menuModals'

const mocks = vi.hoisted(() => ({
  chatStore: { sendInput: vi.fn() },
  chatInputStore: {
    value: '',
    selection: null as { start: number; end: number } | null,
    insertText: vi.fn(),
  },
  menuModalsStore: {
    currentModal: null as string | null,
    nextModal: vi.fn(),
    closeAll: vi.fn(),
  },
}))

vi.mock('../stores/chat', () => ({ useChatStore: () => mocks.chatStore }))

vi.mock('../stores/chatInput', () => ({
  useChatInputStore: () => mocks.chatInputStore,
}))

vi.mock('../stores/menuModals', () => ({
  MenuModals: { VOICE_RECOGNITION: 'voice-recognition' },
  useMenuModalsStore: () => mocks.menuModalsStore,
}))

describe('useChatVoiceInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chatInputStore.value = ''
    mocks.chatInputStore.selection = null
    mocks.menuModalsStore.currentModal = null
  })

  it('passes prefix and suffix from chat input to modal params', () => {
    mocks.chatInputStore.value = 'Hello world'
    mocks.chatInputStore.selection = { start: 5, end: 5 }

    const { openChatVoiceInput } = useChatVoiceInput()
    openChatVoiceInput({ quickSend: false })

    expect(mocks.menuModalsStore.nextModal).toHaveBeenCalledWith(
      MenuModals.VOICE_RECOGNITION,
      expect.objectContaining({
        inline: true,
        chat: true,
        prefix: 'Hello',
        suffix: ' world',
        quickSend: false,
      })
    )
  })

  it('inserts text without sending when intent is insert', () => {
    mocks.chatInputStore.value = 'Existing text'

    const { openChatVoiceInput } = useChatVoiceInput()
    openChatVoiceInput({ quickSend: false })

    const modalParams = mocks.menuModalsStore.nextModal.mock.calls[0][1]
    modalParams.onCorrected('added speech', 'speech', undefined, 'insert')

    expect(mocks.menuModalsStore.closeAll).toHaveBeenCalled()
    expect(mocks.chatInputStore.insertText).toHaveBeenCalledWith('added speech')
    expect(mocks.chatStore.sendInput).not.toHaveBeenCalled()
  })

  it('inserts text and immediately sends input when intent is submit', () => {
    const { openChatVoiceInput } = useChatVoiceInput()
    openChatVoiceInput({ quickSend: false })

    const modalParams = mocks.menuModalsStore.nextModal.mock.calls[0][1]
    modalParams.onCorrected('urgent question', 'speech', undefined, 'submit')

    expect(mocks.menuModalsStore.closeAll).toHaveBeenCalled()
    expect(mocks.chatInputStore.insertText).toHaveBeenCalledWith(
      'urgent question'
    )
    expect(mocks.chatStore.sendInput).toHaveBeenCalled()
  })
})
