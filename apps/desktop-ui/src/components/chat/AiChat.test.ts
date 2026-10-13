import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import AiChat from './AiChat.vue'

const mocks = vi.hoisted(() => ({
  input: { value: 'Next question', clear: vi.fn() },
  retryLastTurn: vi.fn(async () => 'Retried answer'),
  regenerateMessage: vi.fn(async () => 'New answer'),
}))
vi.mock('../../stores/chat-input', () => ({
  useChatInputStore: () => mocks.input,
}))
vi.mock('../../stores/chat', () => ({
  useChatStore: () =>
    reactive({
      currentChatState: { id: 'chat' },
      messages: [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' },
      ],
      error: 'Failed request',
      isStopped: false,
      isGenerating: false,
      pendingImages: [],
      attachedContext: [],
      modelOptions: [],
      selectedModel: null,
      retryLastTurn: mocks.retryLastTurn,
      regenerateMessage: mocks.regenerateMessage,
    }),
}))
vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({ desktopState: { userConfig: {} } }),
}))
vi.mock('../../stores/llm', () => ({
  useLlmStore: () => ({ refreshSecrets: async () => undefined }),
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
  default: () => ({ toast: vi.fn() }),
}))
vi.mock('../../components/menu/VoiceRecognitionMenu.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('../../lib/desktop/window', () => ({
  getDesktopWebview: () => ({ onDragDropEvent: async () => vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.input.value = 'Next question'
})

function mountChat() {
  return shallowMount(AiChat, {
    global: {
      stubs: {
        UiState: { template: '<div><slot /></div>' },
        Button: { template: '<button><slot /></button>' },
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
  expect(mocks.retryLastTurn).toHaveBeenCalledOnce()
  expect(mocks.input.clear).not.toHaveBeenCalled()
  expect(mocks.input.value).toBe('Next question')
  wrapper.unmount()
})

it('connects the assistant message action to regeneration', async () => {
  const wrapper = mountChat()
  const message = wrapper.findAllComponents({ name: 'ChatMessageItem' }).at(-1)!
  expect(message.props('canRegenerate')).toBe(true)
  message.vm.$emit('regenerate')
  await flushPromises()
  expect(mocks.regenerateMessage).toHaveBeenCalledWith(1)
  expect(mocks.input.clear).not.toHaveBeenCalled()
  wrapper.unmount()
})
