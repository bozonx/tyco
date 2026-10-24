import { ref } from 'vue'
import type { ChatHistoryConfig, UserConfig } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsChatHistorySection from './SettingsChatHistorySection.vue'

const mockToast = vi.fn()
const mockClearChatHistory = vi.fn().mockResolvedValue(undefined)
const mockLoadChatHistory = vi.fn().mockResolvedValue(undefined)
const mockChatHistory = ref<Array<{ id: string; title: string }>>([])

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: mockToast, toastText: vi.fn() }),
}))

vi.mock('../../stores/history', () => ({
  useHistoryStore: () => ({
    clearChats: mockClearChatHistory,
    loadChatHistory: mockLoadChatHistory,
    chatHistory: mockChatHistory,
  }),
}))

describe('SettingsChatHistorySection.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChatHistory.value = []
  })

  const createConfig = (
    chatHistory: Partial<ChatHistoryConfig> = {}
  ): Pick<UserConfig, 'chat'> => ({
    chat: {
      imageQuality: 'balanced',
      history: { storage: 'disk', ...chatHistory },
    },
  })

  const mountTab = (userConfig = createConfig()) => {
    return mount(SettingsChatHistorySection, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: {
            props: ['title'],
            template:
              '<section class="section-stub" :data-title="title"><slot name="actions" /><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'info', 'hint', 'nested'],
            template:
              '<div class="field-row-stub" :data-label="label" :data-info="info" :data-hint="hint"><slot /></div>',
          },
          FieldSelect: {
            props: ['modelValue', 'options'],
            template:
              '<select class="field-select-stub" :data-val="modelValue" />',
          },
          FieldSwitch: {
            props: ['modelValue'],
            template:
              '<input type="checkbox" class="field-checkbox-stub" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
          },
          Button: {
            template:
              '<button class="btn-stub" @click="$emit(\'click\')"><slot /></button>',
          },
          ConfirmModal: {
            props: ['open'],
            template:
              '<div v-if="open" class="confirm-modal-stub"><button class="confirm-btn" @click="$emit(\'confirm\')">Confirm</button><button class="cancel-btn" @click="$emit(\'cancel\')">Cancel</button></div>',
          },
        },
      },
    })
  }

  it('renders chat history controls in chat history block', () => {
    const wrapper = mountTab()

    const chatSection = wrapper.get('.section-stub')
    const enabledRow = chatSection.find(
      '[data-label="settings.chatHistoryEnabled"]'
    )
    expect(enabledRow.exists()).toBe(true)
    expect(enabledRow.attributes('data-info')).toBe(
      'settings.chatHistoryEnabledInfo'
    )
    expect(enabledRow.attributes('data-hint')).toBeUndefined()
    expect(
      chatSection
        .find('[data-label="settings.chatHistoryRetentionDays"]')
        .exists()
    ).toBe(true)
    expect(chatSection.find('.btn-stub').text()).toBe('settings.deleteAllChats')
    expect(mockLoadChatHistory).toHaveBeenCalled()
  })

  it('displays the chat count in the clear history row', () => {
    mockChatHistory.value = [
      { id: '1', title: 'Chat 1' },
      { id: '2', title: 'Chat 2' },
    ]
    const wrapper = mountTab()
    const clearRow = wrapper
      .findAll('.field-row-stub')
      .find((row) => row.attributes('data-label') === 'history.clear')
    expect(clearRow?.attributes('data-hint')).toBe(
      'settings.chatCount:{"count":2}'
    )
  })

  it('opens confirm modal on clear chat history button click and clears on confirmation', async () => {
    const wrapper = mountTab()

    const chatSection = wrapper.get('.section-stub')
    const clearButton = chatSection.find('.btn-stub')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)

    await clearButton.trigger('click')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(true)

    await wrapper.find('.confirm-btn').trigger('click')
    expect(mockClearChatHistory).toHaveBeenCalledTimes(1)
    expect(mockToast).toHaveBeenCalledWith('history.cleared', 'info')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
  })

  it('turns the chat history off without asking for confirmation', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    const chatSection = wrapper.get('.section-stub')
    await chatSection.find('.field-checkbox-stub').setValue(false)
    expect(config.chat.history.storage).toBe('off')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
    expect(
      wrapper
        .get('.section-stub')
        .find('[data-label="settings.chatHistoryRetentionDays"]')
        .exists()
    ).toBe(false)
  })

  it('turns the chat history on without asking', async () => {
    const config = createConfig({ storage: 'off' })
    const wrapper = mountTab(config)

    const chatSection = wrapper.get('.section-stub')
    await chatSection.find('.field-checkbox-stub').setValue(true)

    expect(config.chat.history.storage).toBe('disk')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
  })
})
