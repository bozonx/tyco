import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsPluginsTab from './SettingsPluginsTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../stores/ipc', () => ({ useIpcStore: () => ({ call: vi.fn() }) }))
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: vi.fn() }),
}))

vi.mock('../../lib/plugins/builtin-plugins', () => ({
  builtinPluginIds: ['PluginWithConfig'],
}))

vi.mock('../../stores/plugin-runtime', () => ({
  usePluginRuntimeStore: () => ({
    pluginRuntimeStates: {},
    pluginFactories: [
      () => ({
        id: 'PluginWithConfig',
        name: 'PluginWithConfig',
        version: '1.0.0',
        apiVersion: 2,
        capabilities: [],
        defaultLocale: 'en_US',
        locales: { en_US: {}, ru_RU: {}, es_AR: {}, tr_TR: {} },
        labelKey: 'plugin.withConfig.label',
        defaultConfig: {
          fields: [
            {
              type: 'text',
              id: 'apiKey',
              name: 'apiKey',
              version: '1.0.0',
              apiVersion: 2,
              capabilities: [],
              defaultLocale: 'en_US',
              locales: { en_US: {}, ru_RU: {}, es_AR: {}, tr_TR: {} },
              labelKey: 'key',
              defaultValue: 'default-key',
            },
          ],
        },
        init: vi.fn(),
      }),
      () => ({
        id: 'PluginWithoutConfig',
        name: 'PluginWithoutConfig',
        version: '1.0.0',
        apiVersion: 2,
        capabilities: [],
        defaultLocale: 'en_US',
        locales: { en_US: {}, ru_RU: {}, es_AR: {}, tr_TR: {} },
        labelKey: 'plugin.withoutConfig.label',
        init: vi.fn(),
      }),
    ],
    reloadPlugins: vi.fn(),
    refreshInstalledPlugins: vi.fn(async () => {}),
  }),
}))

describe('SettingsPluginsTab.vue', () => {
  it('renders all installed plugins with toggle checkboxes without field config', () => {
    const userConfig = {
      plugins: {
        PluginWithConfig: { isEnabled: true, settings: { apiKey: 'my-key' } },
        PluginWithoutConfig: { isEnabled: false, settings: {} },
      },
    }

    const wrapper = mount(SettingsPluginsTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          FieldSwitch: {
            props: ['modelValue', 'label'],
            template:
              '<button class="checkbox-stub" :data-enabled="modelValue" @click="$emit(\'update:modelValue\', !value)">{{ label }}</button>',
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

  it('switches a plugin from its toggle without opening it', async () => {
    const context = createTestSettingsContext({ plugins: {} })

    const wrapper = mount(SettingsPluginsTab, {
      global: {
        provide: context.provide,
        stubs: {
          FieldSwitch: {
            props: ['modelValue', 'label'],
            template:
              '<button class="checkbox-stub" @click.stop="$emit(\'update:modelValue\', false)">toggle</button>',
          },
        },
      },
    })

    const toggleBtn = wrapper.find(
      '[data-plugin="PluginWithConfig"] .checkbox-stub'
    )
    await toggleBtn.trigger('click')

    expect(context.draft.value.plugins.PluginWithConfig).toEqual({
      isEnabled: false,
      settings: {},
    })
    expect(context.navigate).not.toHaveBeenCalled()
  })

  it('opens a plugin from the card open button', async () => {
    const context = createTestSettingsContext({ plugins: {} })

    const wrapper = mount(SettingsPluginsTab, {
      global: { provide: context.provide, stubs: { FieldSwitch: true } },
    })

    const open = wrapper.find(
      '[data-plugin="PluginWithConfig"] .plugin-card-open'
    )
    expect(open.element.tagName).toBe('BUTTON')
    await open.trigger('click')

    expect(context.navigate).toHaveBeenCalledWith('plugin:PluginWithConfig')
  })
})
