import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import AiChat from './AiChat.vue'

const mocks = vi.hoisted(() => ({
  input: { value: 'Next question', clear: vi.fn() },
  retryLastTurn: vi.fn(async () => 'Retried answer'),
  regenerateMessage: vi.fn(async () => 'New answer'),
  sendInput: vi.fn(async () => true),
  stopGeneration: vi.fn(),
  chatState: {
    currentChatParams: { id: 'chat' },
    messages: [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' },
    ] as any[],
    error: 'Failed request',
    isStopped: false,
    isGenerating: false,
    pendingImages: [] as any[],
    attachedContext: [] as any[],
    pendingToolApprovals: [] as any[],
    answerToolApproval: vi.fn(),
    modelOptions: [] as any[],
    selectedModel: { id: 'm1', name: 'Model 1' } as any,
    retryLastTurn: vi.fn(async () => 'Retried answer'),
    regenerateMessage: vi.fn(async () => 'New answer'),
    sendInput: vi.fn(async () => true),
    stopGeneration: vi.fn(),
  },
}))

vi.mock('../../stores/chat-input', () => ({
  useChatInputStore: () => mocks.input,
}))

vi.mock('../../stores/chat', () => ({
  useChatStore: () => reactive(mocks.chatState),
}))

vi.mock('../../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../../test/desktop-store')
  return {
    useDesktopStore: () => {
      const state = { userConfig: {} }
      return mockDesktopStore(() => state)
    },
  }
})

vi.mock('../../stores/secrets', () => ({
  useSecretsStore: () => ({ refreshSecrets: async () => undefined }),
}))

vi.mock('../../stores/menu-modals', () => ({
  MenuModals: { VOICE_RECOGNITION: 'voice' },
  useMenuModalsStore: () => ({ currentStep: null }),
}))

vi.mock('../../composables/use-chat-voice-input', () => ({
  useChatVoiceInput: () => ({ openChatVoiceInput: vi.fn() }),
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: vi.fn() }),
}))

vi.mock('../../components/menu/VoiceRecognitionMenu.vue', () => ({
  default: { template: '<div />' },
}))

vi.mock('../../lib/desktop/window', () => ({
  getDesktopWebview: () => ({ onDragDropEvent: async () => vi.fn() }),
}))

describe('AiChat.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.input.value = 'Next question'
    mocks.chatState.messages = [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' },
    ]
    mocks.chatState.error = 'Failed request'
    mocks.chatState.isGenerating = false
    mocks.chatState.isStopped = false
  })

  function mountChat() {
    return shallowMount(AiChat, {
      global: {
        stubs: {
          InlineNotice: false,
          StateMessage: {
            props: ['title', 'message', 'kind'],
            template:
              '<div class="ui-state-stub" :data-kind="kind"><slot /></div>',
          },
          Button: { template: '<button><slot /></button>' },
          IconButton: {
            props: ['icon', 'title', 'disabled'],
            template:
              '<button class="icon-btn-stub" :data-icon="icon" :disabled="disabled"><slot /></button>',
          },
          ChatComposer: false,
          ChatInput: true,
          DropdownMenu: true,
          ChatContextList: true,
        },
      },
    })
  }

  it('preserves an unrelated draft after retrying the failed turn', async () => {
    const wrapper = mountChat()
    const retry = wrapper
      .findAll('button')
      .find((button) => button.text() === 'chat.retry')!
    await retry.trigger('click')
    await flushPromises()
    expect(mocks.chatState.retryLastTurn).toHaveBeenCalledOnce()
    expect(mocks.input.clear).not.toHaveBeenCalled()
    expect(mocks.input.value).toBe('Next question')
    wrapper.unmount()
  })

  it('connects the assistant message action to regeneration', async () => {
    const wrapper = mountChat()
    const message = wrapper
      .findAllComponents({ name: 'ChatMessageItem' })
      .at(-1)!
    expect(message.props('canRegenerate')).toBe(true)
    message.vm.$emit('regenerate')
    await flushPromises()
    expect(mocks.chatState.regenerateMessage).toHaveBeenCalledWith(1)
    expect(mocks.input.clear).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('sends input when ChatInput emits send and canSend is true', async () => {
    const wrapper = mountChat()
    const inputComponent = wrapper.findComponent({ name: 'ChatInput' })
    expect(inputComponent.exists()).toBe(true)

    inputComponent.vm.$emit('send')
    await flushPromises()

    expect(mocks.chatState.sendInput).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('rejects an empty submission from the composer', async () => {
    mocks.input.value = '  '
    const wrapper = mountChat()
    const composer = wrapper.getComponent({ name: 'ChatComposer' })
    expect(composer.props('canSend')).toBe(false)
    wrapper.getComponent({ name: 'ChatInput' }).vm.$emit('send')
    await flushPromises()
    expect(mocks.chatState.sendInput).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('triggers stopGeneration when stop button is clicked while generating', async () => {
    mocks.chatState.isGenerating = true
    const wrapper = mountChat()

    const stopBtn = wrapper
      .findAll('.icon-btn-stub')
      .find((btn) => btn.attributes('data-icon') === 'mdi:stop')
    expect(stopBtn).toBeDefined()

    await stopBtn!.trigger('click')
    expect(mocks.chatState.stopGeneration).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('renders empty StateMessage when messages array is empty', () => {
    mocks.chatState.messages = []
    mocks.chatState.error = ''
    const wrapper = mountChat()

    const emptyState = wrapper.find('.chat-empty')
    expect(emptyState.exists()).toBe(true)
    wrapper.unmount()
  })
})
