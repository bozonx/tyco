import type {
  ChatHistoryConfig,
  EditorHistoryConfig,
  UserConfig,
} from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsEditorHistorySection from './SettingsEditorHistorySection.vue'

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

describe('SettingsEditorHistorySection.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createConfig = ({
    editorHistory = {},
    chatHistory = {},
  }: {
    editorHistory?: Partial<EditorHistoryConfig>
    chatHistory?: Partial<ChatHistoryConfig>
  } = {}): Pick<UserConfig, 'editor' | 'chat' | 'isInDevelopment'> => ({
    isInDevelopment: true,
    editor: {
      submitKey: 'Enter',
      diffViewMode: 'unified',
      history: {
        storage: 'disk',
        maxItems: 100,
        retentionDays: 30,
        isSecretSanitizingEnabled: true,
        ...editorHistory,
      },
    },
    chat: {
      imageQuality: 'balanced',
      history: { storage: 'disk', ...chatHistory },
    },
  })

  const mountTab = (userConfig = createConfig()) => {
    return mount(SettingsEditorHistorySection, {
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

  it('renders editor history rows when storage is disk', () => {
    const wrapper = mountTab(
      createConfig({ editorHistory: { storage: 'disk' } })
    )

    const editorSection = wrapper.get('.section-stub')
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

    const editorSection = wrapper.get('.section-stub')
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

    const editorSection = wrapper.get('.section-stub')
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

  it('opens confirm modal on clear editor history button click and clears on confirmation', async () => {
    const wrapper = mountTab()

    const editorSection = wrapper.get('.section-stub')
    const clearButton = editorSection.find('.btn-stub')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)

    await clearButton.trigger('click')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(true)

    await wrapper.find('.confirm-btn').trigger('click')
    expect(mockClearEditorHistory).toHaveBeenCalledTimes(1)
    expect(mockToast).toHaveBeenCalledWith('history.cleared', 'info')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
  })
})
