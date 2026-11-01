import {
  DEFAULT_USER_CONFIG,
  type EditorHistoryConfig,
  type UserConfig,
} from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsEditorHistorySection from './SettingsEditorHistorySection.vue'

const mockToast = vi.fn()
const mockClearEditorHistory = vi.fn().mockResolvedValue(undefined)
const mockHistory = vi.hoisted(() => ({
  editorHistory: [] as Array<{ id: string }>,
  loadEditorHistory: vi.fn(async () => {}),
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: mockToast, toastText: vi.fn() }),
}))

vi.mock('../../stores/history', () => ({
  useHistoryStore: () => ({
    clearEditorHistory: mockClearEditorHistory,
    get editorHistory() {
      return mockHistory.editorHistory
    },
    loadEditorHistory: mockHistory.loadEditorHistory,
  }),
}))

vi.mock('../../composables/use-editor-history-changes', () => ({
  useEditorHistoryChanges: vi.fn(),
}))

describe('SettingsEditorHistorySection.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createConfig = (
    editorHistory: Partial<EditorHistoryConfig> = {}
  ): Pick<UserConfig, 'editor'> => ({
    editor: {
      ...structuredClone(DEFAULT_USER_CONFIG.editor),
      submitKey: 'Enter',
      diffViewMode: 'unified',
      history: {
        storage: 'disk',
        maxItems: 100,
        retentionDays: 30,
        isSecretSanitizingEnabled: true,
        isLocalOnly: false,
        ...editorHistory,
      },
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
            props: ['label', 'info', 'nested', 'hint'],
            template:
              '<div class="field-row-stub" :data-label="label" :data-hint="hint"><slot /></div>',
          },
          FieldSelect: {
            name: 'FieldSelect',
            props: ['modelValue', 'options'],
            emits: ['update:modelValue'],
            template:
              '<select class="field-select-stub" :data-val="modelValue" />',
          },
          FieldNumber: {
            props: ['modelValue'],
            template:
              '<input class="field-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @change="$emit(\'change\')" />',
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
    const wrapper = mountTab(createConfig({ storage: 'disk' }))

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
    const wrapper = mountTab(createConfig({ storage: 'session' }))

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
    const wrapper = mountTab(createConfig({ storage: 'off' }))

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

  it('tells a failed clear instead of leaving it unhandled', async () => {
    mockClearEditorHistory.mockRejectedValueOnce(new Error('Disk unavailable'))
    const wrapper = mountTab()

    await wrapper.find('.btn-stub').trigger('click')
    await wrapper.find('.confirm-btn').trigger('click')
    await flushPromises()

    expect(mockToast).toHaveBeenCalledWith('history.operationFailed', 'error')
    expect(mockToast).not.toHaveBeenCalledWith('history.cleared', 'info')
  })

  it('shows how many entries are stored, also while the history is off', async () => {
    mockHistory.editorHistory = [{ id: 'a' }, { id: 'b' }]
    const wrapper = mountTab(createConfig({ storage: 'off' }))
    await flushPromises()

    expect(mockHistory.loadEditorHistory).toHaveBeenCalled()
    expect(
      wrapper.get('[data-label="history.clear"]').attributes('data-hint')
    ).toBe('settings.editorHistoryCount')
    mockHistory.editorHistory = []
  })

  it('turns the history off without deleting anything or asking', async () => {
    const config = createConfig({ storage: 'disk' })
    const wrapper = mountTab(config)

    wrapper
      .findAllComponents({ name: 'FieldSelect' })[0]
      .vm.$emit('update:modelValue', 'off')
    await flushPromises()

    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
    expect(config.editor.history.storage).toBe('off')
  })

  it('asks before moving the history off the disk', async () => {
    const config = createConfig({ storage: 'disk' })
    const wrapper = mountTab(config)

    wrapper
      .findAllComponents({ name: 'FieldSelect' })[0]
      .vm.$emit('update:modelValue', 'session')
    await flushPromises()

    expect(config.editor.history.storage).toBe('disk')
    await wrapper.find('.confirm-btn').trigger('click')
    expect(config.editor.history.storage).toBe('session')
  })

  it('applies a lower limit only once the field is left and the user agrees', async () => {
    const config = createConfig({ maxItems: 100 })
    const wrapper = mountTab(config)
    const input = wrapper.get('.field-input-stub')

    await input.setValue('5')
    expect(config.editor.history.maxItems).toBe(100)
    await input.setValue('50')
    expect(config.editor.history.maxItems).toBe(100)
    await input.trigger('change')
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(true)

    await wrapper.find('.cancel-btn').trigger('click')
    expect(config.editor.history.maxItems).toBe(100)

    await input.setValue('50')
    await input.trigger('change')
    await wrapper.find('.confirm-btn').trigger('click')
    expect(config.editor.history.maxItems).toBe(50)
  })

  it('applies a higher limit at once', async () => {
    const config = createConfig({ maxItems: 100 })
    const wrapper = mountTab(config)

    await wrapper.get('.field-input-stub').setValue('200')

    expect(config.editor.history.maxItems).toBe(200)
    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
  })
})
