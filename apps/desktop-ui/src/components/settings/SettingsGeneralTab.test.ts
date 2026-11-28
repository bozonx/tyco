import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'
import { AUTO_LANGUAGE_VALUE } from '../../lib/locale/language'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsGeneralTab from './SettingsGeneralTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsGeneralTab.vue', () => {
  function createConfig(overrides: Partial<UserConfig> = {}): UserConfig {
    return reactive({
      ...structuredClone(DEFAULT_USER_CONFIG),
      appearance: {
        theme: 'auto',
        contrast: 'normal',
        motion: 'auto',
        uiScalePercent: 100,
      },
      language: { ui: AUTO_LANGUAGE_VALUE },
      windowInsertion: { linux: { pasteShortcut: 'auto' } },
      ...overrides,
    }) as UserConfig
  }

  const mountTab = (userConfig: UserConfig) => {
    return mount(SettingsGeneralTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          TextInsertionStatus: true,
          SettingsSection: {
            props: ['title'],
            template:
              '<section class="section-stub" :data-title="title"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'info'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          SegmentedControl: {
            props: ['modelValue', 'options'],
            template:
              '<div class="segmented-control-stub" :data-value="modelValue"><button v-for="opt in options" :key="opt.id" :class="\'seg-\' + opt.id" @click="$emit(\'update:modelValue\', opt.id)">{{ opt.name }}</button></div>',
          },
          FieldSelect: {
            props: ['modelValue', 'options'],
            template:
              '<input class="field-select-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          FieldInput: {
            props: ['modelValue'],
            template:
              '<input class="field-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          StorageLocations: {
            template: '<div class="storage-locations-stub" />',
          },
          UserDataFolder: { template: '<div class="user-data-folder-stub" />' },
        },
      },
    })
  }

  it('renders appearance and window insertion sections and storage locations', () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    const sections = wrapper.findAll('.section-stub')
    expect(sections).toHaveLength(2)
    expect(sections[0].attributes('data-title')).toBe(
      'settings.sectionAppearance'
    )
    expect(sections[1].attributes('data-title')).toBe(
      'settings.sectionWindowInsertion'
    )
    expect(wrapper.find('.storage-locations-stub').exists()).toBe(true)
  })

  it('reveals development features and deletes the flag when unchecked', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)
    expect(Object.hasOwn(config, 'isInDevelopment')).toBe(false)
    await wrapper.get('.development-features-trigger').trigger('click')
    expect(config.isInDevelopment).toBe(true)
    expect(wrapper.text()).toContain('settings.developmentFeatures')
    await wrapper.get('input[type="checkbox"]').setValue(false)
    expect(Object.hasOwn(config, 'isInDevelopment')).toBe(false)
    expect(wrapper.find('.development-features-trigger').exists()).toBe(true)
  })

  it('updates theme when segmented control option is clicked', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    const darkBtn = wrapper.find('.seg-dark')
    await darkBtn.trigger('click')

    expect(config.appearance.theme).toBe('dark')
  })

  it('keeps the interface language select visible for automatic and explicit choices', async () => {
    const config = createConfig({ language: { ui: AUTO_LANGUAGE_VALUE } })
    const wrapper = mountTab(config)
    const row = wrapper.get('[data-label="settings.appLanguage"]')
    const trigger = row.get('[role="combobox"]')
    expect(trigger.text()).toBe('settings.appLanguageSystem')

    await trigger.trigger('keydown', { key: 'Enter' })
    await trigger.trigger('keydown', { key: 'End' })
    await trigger.trigger('keydown', { key: 'Enter' })
    expect(config.language.ui).not.toBe(AUTO_LANGUAGE_VALUE)
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('keydown', { key: 'Enter' })
    await trigger.trigger('keydown', { key: 'Home' })
    await trigger.trigger('keydown', { key: 'Enter' })
    expect(config.language.ui).toBe(AUTO_LANGUAGE_VALUE)
    expect(trigger.text()).toBe('settings.appLanguageSystem')
  })

  it('pastes automatically by default and takes a fixed combination', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)
    const field = wrapper.find('[data-label="settings.pasteShortcut"] input')
    expect(field.element).toHaveProperty('value', 'auto')

    await field.setValue('Shift+Insert')
    expect(config.windowInsertion.linux.pasteShortcut).toBe('Shift+Insert')
    expect(
      wrapper.find('[data-label="settings.terminalPasteShortcut"]').exists()
    ).toBe(false)
  })
})
