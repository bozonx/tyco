import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import ChatComposer from './ChatComposer.vue'

const mocks = vi.hoisted(() => ({
  insertText: vi.fn(),
  chatState: {
    importingImages: false,
    imageModelRequired: false,
    omitHistoryImages: false,
    pendingImages: [] as any[],
    messages: [] as any[],
    trimmedTurnCount: 0,
    currentChatParams: { attachments: [] } as any,
    isGenerating: false,
    activeModelId: 'm1',
    modelOptions: [],
    stopGeneration: vi.fn(),
  },
  inputState: { value: '', insertText: vi.fn() },
}))

vi.mock('../../stores/chat', () => ({
  useChatStore: () => reactive(mocks.chatState),
}))

vi.mock('../../stores/chat-input', () => ({
  useChatInputStore: () => reactive(mocks.inputState),
}))

vi.mock('../../composables/use-chat-voice-input', () => ({
  useChatVoiceInput: () => ({ openChatVoiceInput: vi.fn() }),
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ChatComposer.vue', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.inputState.insertText = mocks.insertText
    desktop = installFakeDesktop({}, 'chat')
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('renders prompt presets button and toggles ChatPromptsKeypad', async () => {
    const wrapper = mount(ChatComposer, {
      props: { canSend: true, draggingFiles: false },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          ChatContextList: true,
          ChatInput: true,
          DropdownMenu: true,
          ChatPromptsKeypad: {
            name: 'ChatPromptsKeypad',
            props: ['isOpen', 'anchor'],
            emits: ['close', 'select'],
            template:
              '<div class="keypad-stub" v-if="isOpen"><button class="select-btn" @click="$emit(\'select\', \'My preset prompt\')">Select</button></div>',
          },
        },
      },
    })

    const buttons = wrapper.findAllComponents({ name: 'IconButton' })
    const promptButton = buttons.find(
      (btn) => btn.props('icon') === 'mdi:lightning-bolt-outline'
    )
    expect(promptButton).toBeDefined()
    expect(promptButton!.props('label')).toBe('chat.promptPresets')

    // Keypad initially closed
    expect(wrapper.find('.keypad-stub').exists()).toBe(false)

    // Click prompt presets button to open
    await promptButton!.trigger('click')
    expect(wrapper.find('.keypad-stub').exists()).toBe(true)

    // Select a preset prompt
    await wrapper.find('.select-btn').trigger('click')

    // Expect inserted into chat input store, and keypad closed
    expect(mocks.insertText).toHaveBeenCalledWith('My preset prompt')
    expect(wrapper.find('.keypad-stub').exists()).toBe(false)
  })
})
