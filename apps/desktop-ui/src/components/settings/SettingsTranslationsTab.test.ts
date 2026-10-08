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
            props: ['label', 'info'],
            template:
              '<div class="field-row-stub" :data-label="label" :data-info="info"><slot /></div>',
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

    const qualityRow = wrapper
      .findAll('.field-row-stub')
      .find((r) => r.attributes('data-label') === 'settings.translationQuality')
    expect(qualityRow?.attributes('data-info')).toBe(
      'settings.translationQualityInfo'
    )
  })

  it('emits navigate to languages when clicking quick language setup button', async () => {
    const userConfig = createConfig()
    const wrapper = mount(SettingsTranslationsTab, {
      props: { userConfig },
      global: {
        stubs: {
          SettingsSection: { template: '<section><slot /></section>' },
          FieldRow: { template: '<div><slot /></div>' },
          FieldSelect: true,
          FieldInput: true,
          FieldTextArea: true,
          ShortcutSlots: true,
        },
      },
    })

    const button = wrapper.findComponent({ name: 'Button' })
    expect(button.exists()).toBe(true)
    await button.trigger('click')

    expect(wrapper.emitted('navigate')).toEqual([['languages']])
  })

  it('renders glossary section with info tooltip and no description', () => {
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
          ShortcutSlots: true,
        },
      },
    })

    const sections = wrapper.findAll('.section-stub')
    const firstSection = sections[0]
    const glossarySection = sections[1]

    expect(firstSection.attributes('data-title')).toBeUndefined()
    expect(firstSection.attributes('data-desc')).toBeUndefined()
    expect(glossarySection.attributes('data-title')).toBe(
      'settings.translationGlossary'
    )
    expect(glossarySection.attributes('data-info')).toBe(
      'settings.translationGlossaryInfo'
    )
    expect(glossarySection.attributes('data-desc')).toBeUndefined()
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
