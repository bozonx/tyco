import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsTranslationsTab from './SettingsTranslationsTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const mockToastError = vi.fn()

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: vi.fn(), toastError: mockToastError }),
}))

const mockSetSecret = vi.fn().mockResolvedValue(undefined)
const mockRemoveSecret = vi.fn().mockResolvedValue(undefined)

vi.mock('../../stores/secrets', () => ({
  useSecretsStore: () => ({
    secrets: { deepl: { origins: ['https://api.deepl.com'], available: true } },
    setSecret: mockSetSecret,
    removeSecret: mockRemoveSecret,
  }),
}))

describe('SettingsTranslationsTab.vue', () => {
  const createConfig = (
    overrides = {}
  ): Pick<UserConfig, 'translation' | 'llm'> => ({
    llm: structuredClone(DEFAULT_USER_CONFIG.llm),
    translation: {
      viewMode: 'split',
      provider: 'deepl',
      providers: { deepl: { endpoint: 'free' } },
      qualityGate: 'off',
      glossary: [
        { term: 'foo', translation: 'bar' },
        { term: 'baz', translation: 'baz' },
      ],
      ...overrides,
      targetLanguages: { q: 'en', w: 'es' },
    },
  })

  it('renders provider, quality and deepl options when deepl is selected', () => {
    const userConfig = createConfig()
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: {
            props: ['title', 'description'],
            template: '<section class="section-stub"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'info', 'hint'],
            template:
              '<div class="field-row-stub" :data-label="label" :data-info="info" :data-hint="hint"><slot /></div>',
          },
          FieldSelect: {
            props: ['modelValue', 'options'],
            template:
              '<select class="field-select-stub" :data-val="modelValue" />',
          },
          FieldInput: true,
          FieldTextArea: true,
        },
      },
    })

    const rows = wrapper
      .findAll('.field-row-stub')
      .map((r) => r.attributes('data-label'))
    expect(rows).toContain('settings.translationProvider')
    expect(rows).toContain('settings.translationCorrection')
    expect(rows).not.toContain('settings.deeplPlan')
    expect(rows).toContain('settings.apiKey')

    const providerRow = wrapper
      .findAll('.field-row-stub')
      .find(
        (r) => r.attributes('data-label') === 'settings.translationProvider'
      )
    expect(providerRow?.attributes('data-hint')).toBeUndefined()

    const correctionRow = wrapper
      .findAll('.field-row-stub')
      .find(
        (r) => r.attributes('data-label') === 'settings.translationCorrection'
      )
    expect(correctionRow?.attributes('data-info')).toBe(
      'settings.translationCorrectionInfo'
    )
    expect(rows).not.toContain('settings.translationCorrectionPrompt')
  })

  it('shows the correction prompt only in the always mode', async () => {
    const userConfig = createConfig({ qualityGate: 'always' })
    userConfig.llm.tasks.translation.qualityGateRule = 'Keep it short'
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: { template: '<section><slot /></section>' },
          FieldRow: {
            props: ['label'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: true,
          FieldInput: true,
          FieldTextArea: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template:
              '<textarea class="text-area-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })

    const promptRow = wrapper.find(
      '[data-label="settings.translationCorrectionPrompt"]'
    )
    expect(promptRow.exists()).toBe(true)
    await promptRow.find('textarea').setValue('Be formal')
    expect(userConfig.llm.tasks.translation.qualityGateRule).toBe('Be formal')
  })

  it('auto-detects deepl free vs pro endpoint when saving api key', async () => {
    const userConfig = createConfig({
      providers: { deepl: { endpoint: 'free' } },
    })
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: { template: '<section><slot /></section>' },
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          FieldInput: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template:
              '<input class="key-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          FieldTextArea: true,
        },
      },
    })

    const input = wrapper.find('.key-input-stub')
    const saveButton = wrapper.find('button.btn-primary')

    // Pro key (no :fx suffix)
    await input.setValue('some-pro-key-123')
    await saveButton.trigger('click')
    expect(userConfig.translation.providers.deepl.endpoint).toBe('pro')
    expect(mockSetSecret).toHaveBeenCalledWith(
      'translation.deepl',
      'some-pro-key-123'
    )

    // Free key (with :fx suffix)
    await input.setValue('some-free-key:fx')
    await saveButton.trigger('click')
    expect(userConfig.translation.providers.deepl.endpoint).toBe('free')
    expect(mockSetSecret).toHaveBeenCalledWith(
      'translation.deepl',
      'some-free-key:fx'
    )
  })

  it('reports a key the keychain refused and keeps the endpoint', async () => {
    mockSetSecret.mockRejectedValueOnce(new Error('keychain unavailable'))
    const userConfig = createConfig({
      providers: { deepl: { endpoint: 'free' } },
    })
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: { template: '<section><slot /></section>' },
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          FieldInput: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template:
              '<input class="key-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          FieldTextArea: true,
        },
      },
    })

    await wrapper.find('.key-input-stub').setValue('some-pro-key-123')
    await wrapper.find('button.btn-primary').trigger('click')
    await flushPromises()

    expect(userConfig.translation.providers.deepl.endpoint).toBe('free')
    expect(mockToastError).toHaveBeenCalledWith(
      new Error('keychain unavailable'),
      'settings.keySaveFailed'
    )
  })

  it('keeps an empty correction prompt collapsed behind a button', async () => {
    const userConfig = createConfig({ qualityGate: 'always' })
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: { template: '<section><slot /></section>' },
          FieldRow: {
            props: ['label'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: true,
          FieldInput: true,
          FieldTextArea: true,
        },
      },
    })
    const promptRow = () =>
      wrapper.find('[data-label="settings.translationCorrectionPrompt"]')

    expect(promptRow().exists()).toBe(false)
    await wrapper
      .find('[data-label="settings.translationCorrection"]')
      .findComponent({ name: 'Button' })
      .trigger('click')
    expect(promptRow().exists()).toBe(true)
    expect(
      wrapper
        .find('[data-label="settings.translationCorrection"]')
        .findComponent({ name: 'Button' })
        .exists()
    ).toBe(false)
  })

  it('links to the languages page from the page description', async () => {
    const context = createTestSettingsContext(createConfig())
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: context.provide,
        stubs: {
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          FieldInput: true,
          FieldTextArea: true,
        },
      },
    })

    await wrapper.find('.inline-action').trigger('click')

    expect(context.navigate).toHaveBeenCalledWith('languages')
  })

  it('shows rules only when an AI model translates and hints glossary limits', async () => {
    const context = createTestSettingsContext(createConfig())
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsSection: {
            props: ['title', 'description', 'info'],
            template:
              '<section class="section-stub" :data-title="title" :data-info="info" :data-desc="description"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'info'],
            template:
              '<div class="field-row-stub" :data-label="label" :data-info="info"><slot /></div>',
          },
          FieldSelect: true,
          FieldInput: true,
          FieldTextArea: true,
        },
      },
    })

    const section = (title: string) =>
      wrapper
        .findAll('.section-stub')
        .find((s) => s.attributes('data-title') === title)
    const rulesRow = () =>
      wrapper.find('[data-label="settings.translationRules"]')

    // DeepL without correction never reads translation instructions.
    expect(rulesRow().exists()).toBe(false)
    const glossarySection = section('settings.translationGlossary')
    expect(glossarySection?.attributes('data-info')).toBe(
      'settings.translationGlossaryInfo'
    )
    expect(glossarySection?.attributes('data-desc')).toBe(
      'settings.translationGlossaryMachineHint'
    )

    // DeepL with correction still does not show translation rules (rules are for LLM translation).
    context.draft.value.translation = createConfig({
      qualityGate: 'onProblems',
    }).translation
    await nextTick()
    expect(rulesRow().exists()).toBe(false)
    expect(
      section('settings.translationGlossary')?.attributes('data-desc')
    ).toBeFalsy()

    context.draft.value.translation = createConfig({
      provider: 'llm',
    }).translation
    await nextTick()
    expect(rulesRow().exists()).toBe(true)
    expect(rulesRow().attributes('data-info')).toBe(
      'settings.translationRulesInfo'
    )
  })

  it('hides deepl plan and api key when llm provider is selected', () => {
    const userConfig = createConfig({ provider: 'llm' })
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: {
            props: ['title', 'description', 'info'],
            template: '<section class="section-stub"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'info'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: {
            props: ['modelValue', 'options'],
            template:
              '<select class="field-select-stub" :data-val="modelValue" />',
          },
          FieldInput: true,
          FieldTextArea: true,
        },
      },
    })

    const rows = wrapper
      .findAll('.field-row-stub')
      .map((r) => r.attributes('data-label'))
    expect(rows).toContain('settings.translationProvider')
    expect(rows).toContain('settings.translationCorrection')
    expect(rows).not.toContain('settings.deeplPlan')
    expect(rows).not.toContain('settings.apiKey')
  })

  it('updates glossary entries when glossary text changes', async () => {
    const userConfig = createConfig()
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: { template: '<section><slot /></section>' },
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          FieldInput: true,
          FieldTextArea: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template:
              '<textarea class="text-area-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })

    const textarea = wrapper.findAll('.text-area-stub').at(-1)!
    await textarea.setValue('hello = privet\n!KeepThis')

    expect(userConfig.translation.glossary).toEqual([
      { term: 'hello', translation: 'privet' },
      { term: 'KeepThis', translation: 'KeepThis' },
    ])
  })

  it('shows the translation model only when an AI model translates or reviews', async () => {
    const context = createTestSettingsContext(createConfig())
    const { translation } = context.draft.value
    const wrapper = mount(SettingsTranslationsTab, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsTaskModel: {
            props: ['task'],
            template: '<div class="task-model-stub" :data-task="task" />',
          },
          SecretKeyField: true,
          SecretStorageNotice: true,
        },
      },
    })
    expect(wrapper.find('.task-model-stub').exists()).toBe(false)

    translation.qualityGate = 'onProblems'
    await nextTick()
    expect(wrapper.get('.task-model-stub').attributes('data-task')).toBe(
      'translation'
    )

    translation.qualityGate = 'off'
    translation.provider = 'llm'
    await nextTick()
    expect(wrapper.find('.task-model-stub').exists()).toBe(true)
  })
})
