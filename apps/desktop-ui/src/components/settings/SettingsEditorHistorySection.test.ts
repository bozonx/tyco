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
    mockHistory.editorHistory = [{ id: 'a' }]
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
        retentionDays: 30,
        isSecretSanitizingEnabled: true,
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
              '<section class="section-stub" :data-title="title"><header class="actions-stub"><slot name="actions" /></header><slot /></section>',
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

  const keepingSelect = (wrapper: ReturnType<typeof mountTab>) =>
    wrapper.findAllComponents({ name: 'FieldSelect' })[0]!

  it('offers one choice of how the history is kept', () => {
    const wrapper = mountTab(createConfig({ storage: 'disk' }))

    const select = keepingSelect(wrapper)
    expect(select.props('modelValue')).toBe(30)
    expect(
      (select.props('options') as { id: unknown }[]).map(({ id }) => id)
    ).toEqual(['off', 'session', 1, 7, 30, 90, 365, 0])
    expect(
      wrapper
        .find('[data-label="settings.sanitizeSecretsInEditorHistory"]')
        .exists()
    ).toBe(true)
  })

  it.each(['session', 'off'] as const)(
    'hides secret masking when the history is %s',
    (storage) => {
      const wrapper = mountTab(createConfig({ storage }))

      expect(keepingSelect(wrapper).props('modelValue')).toBe(storage)
      expect(
        wrapper
          .find('[data-label="settings.sanitizeSecretsInEditorHistory"]')
          .exists()
      ).toBe(false)
    }
  )

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

  it('names how many entries the delete button deletes, also while the history is off', async () => {
    mockHistory.editorHistory = [{ id: 'a' }, { id: 'b' }]
    const wrapper = mountTab(createConfig({ storage: 'off' }))
    await flushPromises()

    expect(mockHistory.loadEditorHistory).toHaveBeenCalled()
    expect(wrapper.get('.section-stub').attributes('data-title')).toBe(
      'settings.sectionEditorHistory'
    )
    expect(wrapper.get('.actions-stub .btn-stub').text()).toBe(
      'settings.deleteAllEntries.other'
    )
  })

  it.each(['off', 'session'] as const)(
    'turns the history to %s without deleting anything or asking',
    async (choice) => {
      const config = createConfig({ storage: 'disk' })
      const wrapper = mountTab(config)

      keepingSelect(wrapper).vm.$emit('update:modelValue', choice)
      await flushPromises()

      expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
      expect(mockClearEditorHistory).not.toHaveBeenCalled()
      expect(config.editor.history).toMatchObject({
        storage: choice,
        retentionDays: 30,
      })
    }
  )

  it('applies a shorter retention period at once, without asking', async () => {
    const config = createConfig({ storage: 'disk' })
    const wrapper = mountTab(config)

    keepingSelect(wrapper).vm.$emit('update:modelValue', 7)
    await flushPromises()

    expect(wrapper.find('.confirm-modal-stub').exists()).toBe(false)
    expect(config.editor.history.retentionDays).toBe(7)
  })
})
