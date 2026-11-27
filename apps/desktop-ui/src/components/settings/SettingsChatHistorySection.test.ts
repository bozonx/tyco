import { ref } from 'vue'
import type { ChatHistoryConfig, UserConfig } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsChatHistorySection from './SettingsChatHistorySection.vue'

const mockToast = vi.fn()
const mockClearChatHistory = vi.fn().mockResolvedValue(undefined)
const mockLoadChatHistory = vi.fn().mockResolvedValue(undefined)
const mockChatHistory = ref<Array<{ id: string; title: string }>>([])
const mockProfiles = ref<Array<{ id: string }>>([])
const mockCountAllProfileChats = vi.fn().mockResolvedValue(0)
const mockClearAllProfileChats = vi.fn().mockResolvedValue(undefined)

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: mockToast, toastText: vi.fn() }),
}))

vi.mock('../../stores/ai-profiles', () => ({
  useAiProfilesStore: () => ({
    get profiles() {
      return mockProfiles.value
    },
    countAllProfileChats: mockCountAllProfileChats,
    clearAllProfileChats: mockClearAllProfileChats,
  }),
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
    mockProfiles.value = []
    mockCountAllProfileChats.mockResolvedValue(0)
  })

  const createConfig = (
    chatHistory: Partial<ChatHistoryConfig> = {}
  ): Pick<UserConfig, 'chat'> => ({
    chat: { history: { storage: 'disk', ...chatHistory } },
  })

  const mountTab = (userConfig = createConfig()) => {
    return mount(SettingsChatHistorySection, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: {
            props: ['title', 'info'],
            template:
              '<section class="section-stub" :data-title="title" :data-info="info"><header class="actions-stub"><slot name="actions" /></header><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'info', 'hint', 'nested'],
            template:
              '<div class="field-row-stub" :data-label="label" :data-info="info"><slot /></div>',
          },
          FieldSelect: {
            name: 'FieldSelect',
            props: ['modelValue', 'options'],
            emits: ['update:modelValue'],
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
            props: ['open', 'message'],
            template:
              '<div v-if="open" class="confirm-modal-stub" :data-message="message"><button class="confirm-btn" @click="$emit(\'confirm\')">Confirm</button><button class="cancel-btn" @click="$emit(\'cancel\')">Cancel</button></div>',
          },
        },
      },
    })
  }

  const keepingSelect = (wrapper: ReturnType<typeof mountTab>) =>
    wrapper.findAllComponents({ name: 'FieldSelect' })[0]!

  it('offers one choice of how the chats are kept', () => {
    const wrapper = mountTab(createConfig({ retentionDays: 30 }))

    expect(
      wrapper.find('[data-label="settings.chatHistoryKeeping"]').exists()
    ).toBe(true)
    const select = keepingSelect(wrapper)
    expect(select.props('modelValue')).toBe(30)
    expect(
      (select.props('options') as { id: unknown }[]).map(({ id }) => id)
    ).toEqual(['off', 7, 30, 90, 365, 0])
    expect(
      wrapper.find('[data-label="settings.chatQuickRequestsSaved"]').exists()
    ).toBe(true)
  })

  it('hides the quick request switch while chats are not saved', () => {
    const wrapper = mountTab(createConfig({ storage: 'off' }))

    expect(keepingSelect(wrapper).props('modelValue')).toBe('off')
    expect(
      wrapper.find('[data-label="settings.chatQuickRequestsSaved"]').exists()
    ).toBe(false)
  })

  it('turns saving off without deleting anything or asking', async () => {
    const config = createConfig({ retentionDays: 30 })
    const wrapper = mountTab(config)

    keepingSelect(wrapper).vm.$emit('update:modelValue', 'off')
    await flushPromises()

    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
    expect(mockClearChatHistory).not.toHaveBeenCalled()
    expect(config.chat.history).toEqual({ storage: 'off', retentionDays: 30 })
  })

  it('applies a shorter retention period at once, without asking', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    keepingSelect(wrapper).vm.$emit('update:modelValue', 7)
    await flushPromises()

    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
    expect(config.chat.history).toEqual({ storage: 'disk', retentionDays: 7 })
  })

  it('turns quick request saving off and on', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    await wrapper.get('.field-checkbox-stub').setValue(false)
    expect(config.chat.history.isQuickRequestSavingEnabled).toBe(false)
    await wrapper.get('.field-checkbox-stub').setValue(true)
    expect(config.chat.history).not.toHaveProperty(
      'isQuickRequestSavingEnabled'
    )
  })

  it('names how many chats of "Ask AI" the delete button deletes', async () => {
    mockChatHistory.value = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ]
    const wrapper = mountTab()
    await flushPromises()

    expect(wrapper.get('.section-stub').attributes('data-title')).toBe(
      'settings.sectionChatHistory'
    )
    expect(wrapper.get('.actions-stub .btn-stub').text()).toBe(
      'settings.deleteAllChats.other:{"count":2}'
    )
  })

  it('deletes the chats from the header only after confirmation', async () => {
    mockChatHistory.value = [{ id: 'a', title: 'A' }]
    const wrapper = mountTab()
    await flushPromises()

    await wrapper.get('.actions-stub .btn-stub').trigger('click')
    expect(mockClearChatHistory).not.toHaveBeenCalled()
    expect(wrapper.get('.confirm-modal-stub').attributes('data-message')).toBe(
      'settings.clearChatsConfirmDialog'
    )
    await wrapper.get('.confirm-btn').trigger('click')
    await flushPromises()

    expect(mockClearChatHistory).toHaveBeenCalledOnce()
    expect(mockClearAllProfileChats).not.toHaveBeenCalled()
    expect(mockToast).toHaveBeenCalledWith('history.cleared', 'info')
  })
})
