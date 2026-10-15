import type { UserConfig } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsTranslationsTab from './SettingsTranslationsTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const mockToastText = vi.fn()

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: vi.fn(), toastText: mockToastText }),
}))

const mockSetSecret = vi.fn().mockResolvedValue(undefined)
const mockRemoveSecret = vi.fn().mockResolvedValue(undefined)

vi.mock('../../stores/llm', () => ({
  useLlmStore: () => ({
    secrets: { deepl: { origins: ['https://api.deepl.com'], available: true } },
    setSecret: mockSetSecret,
    removeSecret: mockRemoveSecret,
  }),
}))

describe('SettingsTranslationsTab.vue', () => {
  const createConfig = (
    overrides = {}
  ): Pick<UserConfig, 'translation' | 'aiRules'> => ({
    aiRules: { chat: '', correction: '', translate: '', voiceCorrection: '' },
    translation: {
      viewMode: 'split',
      provider: 'deepl',
      qualityGate: 'off',
      deeplEndpoint: 'free',
      correctionPrompt: '',
      glossary: [
        { term: 'foo', use: 'bar', doNotTranslate: false },
        { term: 'baz', use: 'baz', doNotTranslate: true },
      ],
      ...overrides,
      targetLanguages: ['en', 'es', null, null, null],
    },
  })

  it('renders provider, quality and deepl options when deepl is selected', () => {
    const userConfig = createConfig()
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
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
    const userConfig = createConfig({
      qualityGate: 'always',
      correctionPrompt: 'Keep it short',
    })
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
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
    expect(userConfig.translation.correctionPrompt).toBe('Be formal')
  })

  it('auto-detects deepl free vs pro endpoint when saving api key', async () => {
    const userConfig = createConfig({ deeplEndpoint: 'free' })
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
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
    expect(userConfig.translation.deeplEndpoint).toBe('pro')
    expect(mockSetSecret).toHaveBeenCalledWith('deepl', 'some-pro-key-123')

    // Free key (with :fx suffix)
    await input.setValue('some-free-key:fx')
    await saveButton.trigger('click')
    expect(userConfig.translation.deeplEndpoint).toBe('free')
    expect(mockSetSecret).toHaveBeenCalledWith('deepl', 'some-free-key:fx')
  })

  it('reports a key the keychain refused and keeps the endpoint', async () => {
    mockSetSecret.mockRejectedValueOnce(new Error('keychain unavailable'))
    const userConfig = createConfig({ deeplEndpoint: 'free' })
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
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

    expect(userConfig.translation.deeplEndpoint).toBe('free')
    expect(mockToastText).toHaveBeenCalledWith(
      expect.stringContaining('keychain unavailable'),
      'error'
    )
  })

  it('keeps an empty correction prompt collapsed behind a button', async () => {
    const userConfig = createConfig({ qualityGate: 'always' })
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
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
    const userConfig = createConfig()
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
        stubs: {
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          FieldInput: true,
          FieldTextArea: true,
        },
      },
    })

    await wrapper.find('.inline-action').trigger('click')

    expect(wrapper.emitted('navigate')).toEqual([['languages']])
  })

  it('shows rules only when an AI model reads them and hints glossary limits', async () => {
    const userConfig = createConfig()
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
        stubs: {
          SettingsSection: {
            props: ['title', 'description', 'info'],
            template:
              '<section class="section-stub" :data-title="title" :data-info="info" :data-desc="description"><slot /></section>',
          },
          FieldRow: true,
          FieldSelect: true,
          FieldInput: true,
          FieldTextArea: true,
        },
      },
    })

    const titles = () =>
      wrapper.findAll('.section-stub').map((s) => s.attributes('data-title'))
    const section = (title: string) =>
      wrapper
        .findAll('.section-stub')
        .find((s) => s.attributes('data-title') === title)

    // DeepL without correction never reads the translation instructions.
    expect(titles()).not.toContain('settings.translationRules')
    const glossarySection = section('settings.translationGlossary')
    expect(glossarySection?.attributes('data-info')).toBe(
      'settings.translationGlossaryInfo'
    )
    expect(glossarySection?.attributes('data-desc')).toBe(
      'settings.translationGlossaryMachineHint'
    )

    await wrapper.setProps({
      userConfig: createConfig({ qualityGate: 'onProblems' }),
    })
    expect(section('settings.translationRules')?.attributes('data-info')).toBe(
      'settings.translationRulesInfo'
    )
    expect(
      section('settings.translationGlossary')?.attributes('data-desc')
    ).toBeFalsy()

    await wrapper.setProps({ userConfig: createConfig({ provider: 'llm' }) })
    expect(titles()).toContain('settings.translationRules')
  })

  it('hides deepl plan and api key when llm provider is selected', () => {
    const userConfig = createConfig({ provider: 'llm' })
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
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
      props: { userConfig },
      global: {
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
      { term: 'hello', use: 'privet', doNotTranslate: false },
      { term: 'KeepThis', use: 'KeepThis', doNotTranslate: true },
    ])
  })
})
