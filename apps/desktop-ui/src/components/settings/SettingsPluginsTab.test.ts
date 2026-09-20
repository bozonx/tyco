import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsPluginsTab from './SettingsPluginsTab.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../plugins', () => ({
  pluginIndexes: [
    () => ({
      name: 'PluginWithConfig',
      labelKey: 'plugin.withConfig.label',
      defaultConfig: {
        fields: [
          {
            type: 'text',
            name: 'apiKey',
            labelKey: 'key',
            defaultValue: 'default-key',
          },
        ],
      },
      init: vi.fn(),
    }),
    () => ({
      name: 'PluginWithoutConfig',
      labelKey: 'plugin.withoutConfig.label',
      init: vi.fn(),
    }),
  ],
}))

describe('SettingsPluginsTab.vue', () => {
  it('renders all installed plugins with toggle checkboxes', () => {
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
          FieldsByCfg: {
            props: ['config'],
            template: '<div class="fields-stub" />',
          },
        },
      },
    })

    const pluginCards = wrapper.findAll('[data-plugin]')
    expect(pluginCards).toHaveLength(2)
    expect(pluginCards[0].text()).toContain('plugin.withConfig.label')
    expect(pluginCards[1].text()).toContain('plugin.withoutConfig.label')

    // Enabled plugin with fields displays fields stub
    expect(pluginCards[0].find('.fields-stub').exists()).toBe(true)
    // Disabled plugin hides fields stub
    expect(pluginCards[1].find('.fields-stub').exists()).toBe(false)
  })

  it('emits update:pluginEnabled when toggle is clicked', async () => {
    const userConfig = { plugins: {} }

    const wrapper = mount(SettingsPluginsTab, {
      props: { userConfig },
      global: {
        stubs: {
          FieldCheckbox: {
            props: ['value', 'label'],
            template:
              '<button class="checkbox-stub" @click="$emit(\'update:value\', false)">toggle</button>',
          },
          FieldsByCfg: true,
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
  })

  it('emits update:pluginConfig when fields are updated', async () => {
    const userConfig = {
      plugins: { PluginWithConfig: { enabled: true, apiKey: 'initial' } },
    }

    const wrapper = mount(SettingsPluginsTab, {
      props: { userConfig },
      global: {
        stubs: {
          FieldCheckbox: true,
          FieldsByCfg: {
            props: ['config'],
            template:
              '<button class="update-cfg-stub" @click="$emit(\'update:values\', { apiKey: \'updated\' })">update</button>',
          },
        },
      },
    })

    const updateBtn = wrapper.find('.update-cfg-stub')
    await updateBtn.trigger('click')

    expect(wrapper.emitted('update:pluginConfig')).toBeTruthy()
    expect(wrapper.emitted('update:pluginConfig')![0]).toEqual([
      'PluginWithConfig',
      { apiKey: 'updated' },
    ])
  })
})
