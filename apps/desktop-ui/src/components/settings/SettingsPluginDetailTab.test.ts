import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsPluginDetailTab from './SettingsPluginDetailTab.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsPluginDetailTab.vue', () => {
  const pluginWithConfig = {
    name: 'SamplePlugin',
    labelKey: 'plugin.sample.label',
    enabled: true,
    fields: [{ type: 'text' as const, name: 'token', value: 'secret123' }],
  }

  it('renders plugin details with fields when enabled', () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: pluginWithConfig },
      global: {
        stubs: {
          Button: {
            template:
              '<button class="btn-stub" @click="$emit(\'click\')"><slot /></button>',
          },
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

    expect(wrapper.text()).toContain('plugin.sample.label')
    expect(wrapper.find('.fields-stub').exists()).toBe(true)
  })

  it('emits back when back button clicked', async () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: pluginWithConfig },
      global: {
        stubs: {
          Button: {
            template:
              '<button class="btn-back" @click="$emit(\'click\')"><slot /></button>',
          },
          FieldCheckbox: true,
          FieldsByCfg: true,
        },
      },
    })

    await wrapper.find('.btn-back').trigger('click')
    expect(wrapper.emitted('back')).toBeTruthy()
  })

  it('emits update:pluginEnabled when toggle is clicked', async () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: pluginWithConfig },
      global: {
        stubs: {
          Button: true,
          FieldCheckbox: {
            props: ['value', 'label'],
            template:
              '<button class="checkbox-stub" @click="$emit(\'update:value\', false)">toggle</button>',
          },
          FieldsByCfg: true,
        },
      },
    })

    await wrapper.find('.checkbox-stub').trigger('click')
    expect(wrapper.emitted('update:pluginEnabled')).toEqual([
      ['SamplePlugin', false],
    ])
  })

  it('emits update:pluginConfig when config is modified', async () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: pluginWithConfig },
      global: {
        stubs: {
          Button: true,
          FieldCheckbox: true,
          FieldsByCfg: {
            props: ['config'],
            template:
              '<button class="cfg-stub" @click="$emit(\'update:values\', { token: \'new-token\' })">update</button>',
          },
        },
      },
    })

    await wrapper.find('.cfg-stub').trigger('click')
    expect(wrapper.emitted('update:pluginConfig')).toEqual([
      ['SamplePlugin', { token: 'new-token' }],
    ])
  })

  it('shows disabled hint when plugin is not enabled', () => {
    const wrapper = mount(SettingsPluginDetailTab, {
      props: { plugin: { ...pluginWithConfig, enabled: false } },
      global: {
        stubs: { Button: true, FieldCheckbox: true, FieldsByCfg: true },
      },
    })

    expect(wrapper.find('.fields-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('settings.pluginDisabledHint')
  })
})
