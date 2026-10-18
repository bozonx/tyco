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
      language: { ui: AUTO_LANGUAGE_VALUE, user: 'en_US' },
      windowInsertion: {
        pasteShortcut: 'ctrl+v',
        linux: { method: 'xdotool', xdotoolPath: '', ydotoolPath: '' },
      },
      ...overrides,
    }) as UserConfig
  }

  const mountTab = (userConfig: UserConfig) => {
    return mount(SettingsGeneralTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
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

  it('updates theme when segmented control option is clicked', async () => {
    const config = createConfig()
    const wrapper = mountTab(config)

    const darkBtn = wrapper.find('.seg-dark')
    await darkBtn.trigger('click')

    expect(config.appearance.theme).toBe('dark')
  })

  it('toggles app language mode between auto and manual', async () => {
    const config = createConfig({
      language: { ui: AUTO_LANGUAGE_VALUE, user: 'auto' },
    })
    const wrapper = mountTab(config)

    const toggleBtn = wrapper.find('button.btn')
    expect(toggleBtn.text()).toBe('settings.appLanguageManual')

    await toggleBtn.trigger('click')
    expect(config.language.ui).not.toBe(AUTO_LANGUAGE_VALUE)

    await toggleBtn.trigger('click')
    expect(config.language.ui).toBe(AUTO_LANGUAGE_VALUE)
  })

  it('shows the path of the tool of the chosen insertion method', async () => {
    const config = createConfig({
      windowInsertion: {
        pasteShortcut: 'ctrl+v',
        linux: { method: 'xdotool', xdotoolPath: '', ydotoolPath: '' },
      },
    })
    const wrapper = mountTab(config)

    expect(wrapper.find('.field-input-stub').exists()).toBe(true)

    const ydotoolBtn = wrapper.find('.seg-ydotool')
    await ydotoolBtn.trigger('click')

    expect(config.windowInsertion.linux.method).toBe('ydotool')
    expect(wrapper.find('.field-input-stub').exists()).toBe(true)
  })
})
