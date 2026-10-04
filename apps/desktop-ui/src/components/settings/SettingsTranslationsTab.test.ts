import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsTranslationsTab from './SettingsTranslationsTab.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const mockSetSecret = vi.fn().mockResolvedValue(undefined)
const mockRemoveSecret = vi.fn().mockResolvedValue(undefined)

vi.mock('../../stores/llm', () => ({
  useLlmStore: () => ({
    secrets: { deepl: 'tyco-secret:deepl' },
    setSecret: mockSetSecret,
    removeSecret: mockRemoveSecret,
  }),
}))

describe('SettingsTranslationsTab.vue', () => {
  const createConfig = (overrides = {}) => ({
    toTranslateLanguages: ['en', 'es', null, null, null],
    translation: {
      provider: 'deepl',
      qualityGate: 'on_problems',
      deeplEndpoint: 'free',
      glossary: [
        { term: 'foo', use: 'bar', doNotTranslate: false },
        { term: 'baz', use: 'baz', doNotTranslate: true },
      ],
      ...overrides,
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
            props: ['label'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: {
            props: ['value', 'options'],
            template: '<select class="field-select-stub" :data-val="value" />',
          },
          FieldInput: true,
          FieldTextArea: true,
          ShortcutSlots: true,
        },
      },
    })

    const rows = wrapper
      .findAll('.field-row-stub')
      .map((r) => r.attributes('data-label'))
    expect(rows).toContain('settings.translationProvider')
    expect(rows).toContain('settings.translationQuality')
    expect(rows).toContain('settings.deeplPlan')
    expect(rows).toContain('settings.apiKey')
  })

  it('hides deepl plan and api key when llm provider is selected', () => {
    const userConfig = createConfig({ provider: 'llm' })
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
        stubs: {
          SettingsSection: {
            props: ['title', 'description'],
            template: '<section class="section-stub"><slot /></section>',
          },
          FieldRow: {
            props: ['label'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: {
            props: ['value', 'options'],
            template: '<select class="field-select-stub" :data-val="value" />',
          },
          FieldInput: true,
          FieldTextArea: true,
          ShortcutSlots: true,
        },
      },
    })

    const rows = wrapper
      .findAll('.field-row-stub')
      .map((r) => r.attributes('data-label'))
    expect(rows).toContain('settings.translationProvider')
    expect(rows).toContain('settings.translationQuality')
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
            props: ['value'],
            emits: ['update:value'],
            template:
              '<textarea class="text-area-stub" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
          },
          ShortcutSlots: true,
        },
      },
    })

    const textarea = wrapper.find('.text-area-stub')
    await textarea.setValue('hello = privet\n!KeepThis')

    expect(userConfig.translation.glossary).toEqual([
      { term: 'hello', use: 'privet', doNotTranslate: false },
      { term: 'KeepThis', use: 'KeepThis', doNotTranslate: true },
    ])
  })
})
