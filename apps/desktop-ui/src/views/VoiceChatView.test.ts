import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VoiceChatView from './VoiceChatView.vue'

const mocks = vi.hoisted(() => ({
  params: {
    selectedText: 'Selected context' as string | null,
    isWindowShown: true,
    mode: 'voiceChat',
    activationId: 1,
  },
  chat: {
    voiceChatContext: { text: 'Selected context', source: 'selection' } as {
      text: string
      source: string
    } | null,
  },
  navPanel: { resetNavParams: vi.fn() },
  menuModals: { anyModalOpen: false },
  callFunction: vi.fn(),
}))

vi.mock('../components/common/ContentPadding.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

vi.mock('../components/menu/VoiceRecognitionMenu.vue', () => ({
  default: {
    name: 'VoiceRecognitionMenu',
    props: ['variant', 'quickSend', 'context'],
    emits: ['corrected', 'cancelled', 'removeContext'],
    template: '<div class="voice-menu" />',
  },
}))

vi.mock('../components/menu/InsertMenu.vue', () => ({
  default: {
    name: 'InsertMenu',
    props: ['text', 'allowInsertButton', 'stopListening'],
    template: '<div class="insert-menu" />',
  },
}))

vi.mock('../stores/menuModals', () => ({
  useMenuModalsStore: () => mocks.menuModals,
}))

vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({
    params: reactive(mocks.params),
    callFunction: mocks.callFunction,
  }),
}))

vi.mock('../stores/navPanel', () => ({
  useNavPanelStore: () => mocks.navPanel,
}))

vi.mock('../stores/chat', () => ({ useChatStore: () => mocks.chat }))

describe('VoiceChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.params.selectedText = 'Selected context'
    mocks.chat.voiceChatContext = {
      text: 'Selected context',
      source: 'selection',
    }
  })

  it('shows the context the question goes with', () => {
    const wrapper = mount(VoiceChatView)
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    expect(menu.props('context')).toBe('Selected context')
  })

  it('sends the question without the context the user removed', async () => {
    const wrapper = mount(VoiceChatView)
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit('removeContext')
    await flushPromises()
    expect(menu.props('context')).toBeUndefined()

    menu.vm.$emit('corrected', 'Why?', 'Why?', undefined, 'submit')
    await flushPromises()

    expect(mocks.callFunction).toHaveBeenCalledWith('openMainChat', [
      undefined,
      'Why?',
      true,
    ])
  })

  it('submits voice result to main chat with autoSend=true when intent is submit', async () => {
    const wrapper = mount(VoiceChatView)
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit(
      'corrected',
      'How does this work?',
      'How does this work?',
      undefined,
      'submit'
    )
    await flushPromises()

    expect(mocks.callFunction).toHaveBeenCalledWith('openMainChat', [
      { text: 'Selected context', source: 'selection' },
      'How does this work?',
      true,
    ])
    expect(mocks.callFunction).toHaveBeenCalledWith('dismissQuickWindow')
  })

  it('inserts voice result into chat input with autoSend=false when intent is insert', async () => {
    const wrapper = mount(VoiceChatView)
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit(
      'corrected',
      'Explain this function',
      'Explain this function',
      undefined,
      'insert'
    )
    await flushPromises()

    expect(mocks.callFunction).toHaveBeenCalledWith('openMainChat', [
      { text: 'Selected context', source: 'selection' },
      'Explain this function',
      false,
    ])
    expect(mocks.callFunction).toHaveBeenCalledWith('dismissQuickWindow')
  })

  it('opens the actions for the text instead of the chat when intent is next', async () => {
    const wrapper = mount(VoiceChatView)
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit('corrected', 'Some text', 'Some text', undefined, 'next')
    await flushPromises()

    expect(
      wrapper.findComponent({ name: 'VoiceRecognitionMenu' }).exists()
    ).toBe(false)
    expect(wrapper.findComponent({ name: 'InsertMenu' }).props('text')).toBe(
      'Some text'
    )
    expect(mocks.callFunction).not.toHaveBeenCalled()
  })

  it('dismisses quick window on cancel', async () => {
    const wrapper = mount(VoiceChatView)
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit('cancelled')

    expect(mocks.callFunction).toHaveBeenCalledWith('dismissQuickWindow')
    expect(mocks.callFunction).not.toHaveBeenCalledWith(
      'openMainChat',
      expect.anything()
    )
  })
})
