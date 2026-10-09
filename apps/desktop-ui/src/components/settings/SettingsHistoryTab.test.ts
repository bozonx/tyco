import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsHistoryTab from './SettingsHistoryTab.vue'

const mockToast = vi.fn()
const mockClearChatHistory = vi.fn().mockResolvedValue(undefined)

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/useToast', () => ({
  default: () => ({ toast: mockToast, toastText: vi.fn() }),
}))

vi.mock('../../stores/history', () => ({
  useHistoryStore: () => ({ clearChatHistory: mockClearChatHistory }),
}))

describe('SettingsHistoryTab.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createConfig = (overrides = {}) => ({
    editorHistoryStorage: 'disk',
    editorHistoryMaxItems: 100,
    editorHistoryRetentionDays: 30,
    sanitizeSecretsInEditorHistory: true,
    chatHistoryMaxItems: 20,
    ...overrides,
  })

  const mountTab = (userConfig = createConfig()) => {
    return mount(SettingsHistoryTab, {
      props: { userConfig },
      global: {
        stubs: {
          SettingsSection: {
            props: ['title'],
            template:
              '<section class="section-stub" :data-title="title"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'info', 'nested'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: {
            props: ['value', 'options'],
            template: '<select class="field-select-stub" :data-val="value" />',
          },
          FieldInput: {
            props: ['value'],
            template:
              '<input class="field-input-stub" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
          },
          FieldCheckbox: {
            props: ['value'],
            template:
              '<input type="checkbox" class="field-checkbox-stub" :checked="value" @change="$emit(\'update:value\', $event.target.checked)" />',
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
    const wrapper = mountTab(createConfig({ editorHistoryStorage: 'disk' }))

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
    const wrapper = mountTab(createConfig({ editorHistoryStorage: 'session' }))

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
    const wrapper = mountTab(createConfig({ editorHistoryStorage: 'off' }))

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
      chatSection.find('[data-label="settings.chatHistoryMaxItems"]').exists()
    ).toBe(true)
    expect(
      chatSection.find('[data-label="settings.clearChatHistory"]').exists()
    ).toBe(true)
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

  it('updates chatHistoryMaxItems when valid value is input', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    const chatSection = wrapper.findAll('.section-stub')[1]
    const input = chatSection.find('.field-input-stub')
    await input.setValue('0')

    expect(config.chatHistoryMaxItems).toBe(0)
  })
})
