import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VoiceChatView from './VoiceChatView.vue'

const mocks = vi.hoisted(() => ({
  desktopState: {
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
  callFunctionOrNotify: vi.fn(),
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
    props: ['text', 'allowInsertButton', 'shortcutsDisabled'],
    template: '<div class="insert-menu" />',
  },
}))

vi.mock('../stores/menu-modals', () => ({
  useMenuModalsStore: () => mocks.menuModals,
}))

vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({
    desktopState: reactive(mocks.desktopState),
    callFunction: mocks.callFunction,
    callFunctionOrNotify: mocks.callFunctionOrNotify,
  }),
}))

vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => mocks.navPanel,
}))

vi.mock('../stores/chat', () => ({ useChatStore: () => mocks.chat }))

describe('VoiceChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.callFunctionOrNotify.mockResolvedValue({ success: true })
    mocks.desktopState.activationId = 1
    mocks.desktopState.mode = 'voiceChat'
    mocks.desktopState.isWindowShown = true
    mocks.desktopState.selectedText = 'Selected context'
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

    expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('openMainChat', [
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

    expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('openMainChat', [
      { text: 'Selected context', source: 'selection' },
      'How does this work?',
      true,
    ])
    expect(mocks.callFunction).not.toHaveBeenCalled()
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

    expect(mocks.callFunctionOrNotify).toHaveBeenCalledWith('openMainChat', [
      { text: 'Selected context', source: 'selection' },
      'Explain this function',
      false,
    ])
    expect(mocks.callFunction).not.toHaveBeenCalled()
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

  it('keeps the recognized text in the actions menu when opening chat fails', async () => {
    mocks.callFunctionOrNotify.mockResolvedValue({
      success: false,
      error: 'Failed',
    })
    const wrapper = mount(VoiceChatView)
    wrapper
      .findComponent({ name: 'VoiceRecognitionMenu' })
      .vm.$emit(
        'corrected',
        'Keep these words',
        'Keep these words',
        undefined,
        'submit'
      )
    await flushPromises()
    expect(wrapper.findComponent({ name: 'InsertMenu' }).props('text')).toBe(
      'Keep these words'
    )
    expect(mocks.callFunction).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not put a failed handoff into a newer activation', async () => {
    let resolve!: (result: { success: false; error: string }) => void
    mocks.callFunctionOrNotify.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const wrapper = mount(VoiceChatView)
    wrapper
      .findComponent({ name: 'VoiceRecognitionMenu' })
      .vm.$emit('corrected', 'Old words', 'Old words', undefined, 'submit')
    reactive(mocks.desktopState).activationId++
    resolve({ success: false, error: 'Failed' })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'InsertMenu' }).exists()).toBe(false)
    expect(mocks.callFunction).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
