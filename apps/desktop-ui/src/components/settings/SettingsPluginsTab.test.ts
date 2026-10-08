import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsPluginsTab from './SettingsPluginsTab.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({ callFunction: vi.fn() }),
}))
vi.mock('../../composables/useToast', () => ({
  default: () => ({ toast: vi.fn() }),
}))

vi.mock('../../plugins', () => ({
  builtinPluginIds: ['PluginWithConfig'],
  usePlugins: () => ({ refreshInstalledPlugins: vi.fn(async () => {}) }),
  pluginRuntimeStates: {},
  pluginIndexes: [
    () => ({
      id: 'PluginWithConfig', name: 'PluginWithConfig', version: '1.0.0', apiVersion: 2, capabilities: [], defaultLocale: 'en_US', locales: { en_US: {} },
      labelKey: 'plugin.withConfig.label',
      defaultConfig: {
        fields: [
          {
            type: 'text',
            id: 'apiKey', name: 'apiKey', version: '1.0.0', apiVersion: 2, capabilities: [], defaultLocale: 'en_US', locales: { en_US: {} },
            labelKey: 'key',
            defaultValue: 'default-key',
          },
        ],
      },
      init: vi.fn(),
    }),
    () => ({
      id: 'PluginWithoutConfig', name: 'PluginWithoutConfig', version: '1.0.0', apiVersion: 2, capabilities: [], defaultLocale: 'en_US', locales: { en_US: {} },
      labelKey: 'plugin.withoutConfig.label',
      init: vi.fn(),
    }),
  ],
}))

describe('SettingsPluginsTab.vue', () => {
  it('renders all installed plugins with toggle checkboxes without field config', () => {
    const userConfig = {
      plugins: {
        PluginWithConfig: { enabled: true, apiKey: 'my-key' },
        PluginWithoutConfig: { enabled: false },
      },
    }

    const wrapper = mount(SettingsPluginsTab, {
      props: { userConfig },
      global: {
        stubs: {
          FieldCheckbox: {
            props: ['value', 'label'],
            template:
              '<button class="checkbox-stub" :data-enabled="value" @click="$emit(\'update:value\', !value)">{{ label }}</button>',
          },
        },
      },
    })

    const pluginCards = wrapper.findAll('[data-plugin]')
    expect(pluginCards).toHaveLength(2)
    expect(pluginCards[0].text()).toContain('plugin.withConfig.label')
    expect(pluginCards[1].text()).toContain('plugin.withoutConfig.label')

    // Fields are not rendered on the main plugins list tab
    expect(wrapper.find('.fields-stub').exists()).toBe(false)
  })

  it('emits update:pluginEnabled when toggle is clicked without selecting plugin', async () => {
    const userConfig = { plugins: {} }

    const wrapper = mount(SettingsPluginsTab, {
      props: { userConfig },
      global: {
        stubs: {
          FieldCheckbox: {
            props: ['value', 'label'],
            template:
              '<button class="checkbox-stub" @click.stop="$emit(\'update:value\', false)">toggle</button>',
          },
        },
      },
    })

    const toggleBtn = wrapper.find(
      '[data-plugin="PluginWithConfig"] .checkbox-stub'
    )
    await toggleBtn.trigger('click')

    expect(wrapper.emitted('update:pluginEnabled')).toBeTruthy()
    expect(wrapper.emitted('update:pluginEnabled')![0]).toEqual([
      'PluginWithConfig',
      false,
    ])
    expect(wrapper.emitted('selectPlugin')).toBeFalsy()
  })

  it('emits selectPlugin when card is clicked', async () => {
    const userConfig = { plugins: {} }

    const wrapper = mount(SettingsPluginsTab, {
      props: { userConfig },
      global: { stubs: { FieldCheckbox: true } },
    })

    const card = wrapper.find('[data-plugin="PluginWithConfig"]')
    await card.trigger('click')

    expect(wrapper.emitted('selectPlugin')).toBeTruthy()
    expect(wrapper.emitted('selectPlugin')![0]).toEqual(['PluginWithConfig'])
  })
})
