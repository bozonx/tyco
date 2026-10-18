import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsPluginDetailTab from './SettingsPluginDetailTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsPluginDetailTab.vue', () => {
  let context: ReturnType<typeof createTestSettingsContext>
  beforeEach(() => {
    context = createTestSettingsContext({ plugins: {} })
  })

  const pluginWithConfig = {
    pluginId: 'SamplePlugin',
    labelKey: 'plugin.sample.label',
    isEnabled: true,
    fields: [{ type: 'text' as const, name: 'token', value: 'secret123' }],
  }

  it('renders plugin details with fields when enabled', () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: pluginWithConfig },
      global: {
        provide: context.provide,
        stubs: {
          Button: {
            template:
              '<button class="btn-stub" @click="$emit(\'click\')"><slot /></button>',
          },
          FieldSwitch: {
            props: ['modelValue', 'label'],
            template:
              '<button class="checkbox-stub" :data-enabled="modelValue" @click="$emit(\'update:modelValue\', !value)">{{ label }}</button>',
          },
          ConfigFields: {
            props: ['config'],
            template: '<div class="fields-stub" />',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('plugin.sample.label')
    expect(wrapper.find('.fields-stub').exists()).toBe(true)
  })

  it('goes back to the plugins from the back button', async () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: pluginWithConfig },
      global: {
        provide: context.provide,
        stubs: {
          Button: {
            template:
              '<button class="btn-back" @click="$emit(\'click\')"><slot /></button>',
          },
          FieldSwitch: true,
          ConfigFields: true,
        },
      },
    })

    await wrapper.find('.btn-back').trigger('click')
    expect(context.navigate).toHaveBeenCalledWith('plugins')
  })

  it('switches the plugin from its toggle', async () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: pluginWithConfig },
      global: {
        provide: context.provide,
        stubs: {
          Button: true,
          FieldSwitch: {
            props: ['modelValue', 'label'],
            template:
              '<button class="checkbox-stub" @click="$emit(\'update:modelValue\', false)">toggle</button>',
          },
          ConfigFields: true,
        },
      },
    })

    await wrapper.find('.checkbox-stub').trigger('click')
    expect(context.draft.value.plugins.SamplePlugin).toEqual({ enabled: false })
  })

  it('stores the modified plugin config', async () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: pluginWithConfig },
      global: {
        provide: context.provide,
        stubs: {
          Button: true,
          FieldSwitch: true,
          ConfigFields: {
            props: ['config'],
            template:
              '<button class="cfg-stub" @click="$emit(\'update:values\', { token: \'new-token\' })">update</button>',
          },
        },
      },
    })

    await wrapper.find('.cfg-stub').trigger('click')
    expect(context.draft.value.plugins.SamplePlugin).toEqual({
      token: 'new-token',
    })
  })

  it('shows disabled hint when plugin is not enabled', () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: { ...pluginWithConfig, isEnabled: false } },
      global: {
        provide: context.provide,
        stubs: { Button: true, FieldSwitch: true, ConfigFields: true },
      },
    })

    expect(wrapper.find('.fields-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('settings.pluginDisabledHint')
  })
})
