import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VoiceChatView from './VoiceChatView.vue'

const mocks = vi.hoisted(() => ({
  params: {
    selectedText: 'Selected context' as string | null,
    isWindowShown: true,
    mode: 'voiceChat',
  },
  editorInput: { selectedText: '', value: '' },
  navPanel: { resetNavParams: vi.fn() },
  callFunction: vi.fn(),
}))

vi.mock('../components/common/ContentPadding.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

vi.mock('../components/menu/VoiceRecognitionMenu.vue', () => ({
  default: {
    name: 'VoiceRecognitionMenu',
    props: ['variant', 'quickSend'],
    emits: ['corrected', 'cancelled'],
    template: '<div class="voice-menu" />',
  },
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

vi.mock('../stores/editorInput', () => ({
  useEditorInputStore: () => mocks.editorInput,
}))

describe('VoiceChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.params.selectedText = 'Selected context'
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
      'Selected context',
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
      'Selected context',
      'Explain this function',
      false,
    ])
    expect(mocks.callFunction).toHaveBeenCalledWith('dismissQuickWindow')
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
