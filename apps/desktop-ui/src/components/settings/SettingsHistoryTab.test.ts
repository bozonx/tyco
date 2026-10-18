import type { UserConfig } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsHistoryTab from './SettingsHistoryTab.vue'

const mockToast = vi.fn()
const mockClearChatHistory = vi.fn().mockResolvedValue(undefined)
const mockClearEditorHistory = vi.fn().mockResolvedValue(undefined)

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: mockToast, toastText: vi.fn() }),
}))

vi.mock('../../stores/history', () => ({
  useHistoryStore: () => ({
    clearChats: mockClearChatHistory,
    clearEditorHistory: mockClearEditorHistory,
  }),
}))

describe('SettingsHistoryTab.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createConfig = (
    overrides = {}
  ): Pick<UserConfig, 'editorHistory' | 'chat'> => ({
    editorHistory: {
      storage: 'disk',
      maxItems: 100,
      retentionDays: 30,
      sanitizeSecrets: true,
    },

    chat: {
      imageQuality: 'balanced',
      isHistoryEnabled: true,
      historyRetentionDays: 0,
    },

    ...overrides,
  })

  const mountTab = (userConfig = createConfig()) => {
    return mount(SettingsHistoryTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: {
            props: ['title'],
            template:
              '<section class="section-stub" :data-title="title"><slot name="actions" /><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'info', 'nested'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: {
            props: ['modelValue', 'options'],
            template:
              '<select class="field-select-stub" :data-val="modelValue" />',
          },
          FieldNumber: {
            props: ['modelValue'],
            template:
              '<input class="field-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
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

  it('renders two blocks: editor history and chat history', () => {
    const wrapper = mountTab()

    const sections = wrapper.findAll('.section-stub')
    expect(sections).toHaveLength(2)
    expect(sections[0].attributes('data-title')).toBe(
      'settings.sectionEditorHistory'
    )
    expect(sections[1].attributes('data-title')).toBe(
      'settings.sectionChatHistory'
    )
  })

  it('renders editor history rows when storage is disk', () => {
    const wrapper = mountTab(
      createConfig({ editorHistory: { storage: 'disk' } })
    )

    const editorSection = wrapper.findAll('.section-stub')[0]
    expect(
      editorSection
        .find('[data-label="settings.editorHistoryStorage"]')
        .exists()
    ).toBe(true)
    expect(
      editorSection
        .find('[data-label="settings.editorHistoryMaxItems"]')
        .exists()
    ).toBe(true)
    expect(
      editorSection
        .find('[data-label="settings.editorHistoryRetentionDays"]')
        .exists()
    ).toBe(true)
    expect(
      editorSection
        .find('[data-label="settings.sanitizeSecretsInEditorHistory"]')
        .exists()
    ).toBe(true)
  })

  it('hides retention and secret masking when storage is session', () => {
    const wrapper = mountTab(
      createConfig({ editorHistory: { storage: 'session' } })
    )

    const editorSection = wrapper.findAll('.section-stub')[0]
    expect(
      editorSection
        .find('[data-label="settings.editorHistoryStorage"]')
        .exists()
    ).toBe(true)
    expect(
      editorSection
        .find('[data-label="settings.editorHistoryMaxItems"]')
        .exists()
    ).toBe(true)
    expect(
      editorSection
        .find('[data-label="settings.editorHistoryRetentionDays"]')
        .exists()
    ).toBe(false)
    expect(
      editorSection
        .find('[data-label="settings.sanitizeSecretsInEditorHistory"]')
        .exists()
    ).toBe(false)
  })

  it('hides all nested options when storage is off', () => {
    const wrapper = mountTab(
      createConfig({ editorHistory: { storage: 'off' } })
    )

    const editorSection = wrapper.findAll('.section-stub')[0]
    expect(
      editorSection
        .find('[data-label="settings.editorHistoryStorage"]')
        .exists()
    ).toBe(true)
    expect(
      editorSection
        .find('[data-label="settings.editorHistoryMaxItems"]')
        .exists()
    ).toBe(false)
  })

  it('renders chat history controls in chat history block', () => {
    const wrapper = mountTab()

    const chatSection = wrapper.findAll('.section-stub')[1]
    expect(
      chatSection.find('[data-label="settings.chatHistoryEnabled"]').exists()
    ).toBe(true)
    expect(
      chatSection
        .find('[data-label="settings.chatHistoryRetentionDays"]')
        .exists()
    ).toBe(true)
    expect(chatSection.find('.btn-stub').exists()).toBe(true)
  })

  it('opens confirm modal on clear editor history button click and clears on confirmation', async () => {
    const wrapper = mountTab()

    const editorSection = wrapper.findAll('.section-stub')[0]
    const clearButton = editorSection.find('.btn-stub')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)

    await clearButton.trigger('click')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(true)

    await wrapper.find('.confirm-btn').trigger('click')
    expect(mockClearEditorHistory).toHaveBeenCalledTimes(1)
    expect(mockToast).toHaveBeenCalledWith('history.cleared', 'info')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
  })

  it('opens confirm modal on clear chat history button click and clears on confirmation', async () => {
    const wrapper = mountTab()

    const chatSection = wrapper.findAll('.section-stub')[1]
    const clearButton = chatSection.find('.btn-stub')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)

    await clearButton.trigger('click')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(true)

    await wrapper.find('.confirm-btn').trigger('click')
    expect(mockClearChatHistory).toHaveBeenCalledTimes(1)
    expect(mockToast).toHaveBeenCalledWith('history.cleared', 'info')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
  })

  it('turns the chat history off only after the confirmation', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    const chatSection = wrapper.findAll('.section-stub')[1]
    await chatSection.find('.field-checkbox-stub').setValue(false)
    expect(config.chat.isHistoryEnabled).toBe(true)
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(true)

    await wrapper.find('.cancel-btn').trigger('click')
    expect(config.chat.isHistoryEnabled).toBe(true)
    expect(
      (chatSection.find('.field-checkbox-stub').element as HTMLInputElement)
        .checked
    ).toBe(true)

    await chatSection.find('.field-checkbox-stub').setValue(false)
    await wrapper.find('.confirm-btn').trigger('click')
    expect(config.chat.isHistoryEnabled).toBe(false)
    expect(
      wrapper
        .findAll('.section-stub')[1]
        .find('[data-label="settings.chatHistoryRetentionDays"]')
        .exists()
    ).toBe(false)
  })

  it('turns the chat history on without asking', async () => {
    const config = createConfig({ chat: { isHistoryEnabled: false } })
    const wrapper = mountTab(config)

    const chatSection = wrapper.findAll('.section-stub')[1]
    await chatSection.find('.field-checkbox-stub').setValue(true)

    expect(config.chat.isHistoryEnabled).toBe(true)
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
  })
})
