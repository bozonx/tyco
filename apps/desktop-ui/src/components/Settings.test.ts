import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Settings from './Settings.vue'

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../composables/useToast', () => ({
  default: () => ({ toastText: vi.fn() }),
}))

vi.mock('../stores/actionMenu', () => ({
  useActionMenuStore: () => ({
    clearRegisteredActions: vi.fn(),
    resolveMainActions: (actions: any) => actions ?? [],
    getRegisteredActions: () => [],
  }),
}))

vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({
    params: {
      userConfig: {
        theme: 'auto',
        contrast: 'normal',
        motion: 'auto',
        plugins: { PluginA: { enabled: true }, PluginB: { enabled: false } },
      },
    },
    callFunction: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'getStorageInfo') {
        return Promise.resolve({
          success: true,
          result: {
            configDir: '/test/config',
            dataDir: '/test/data',
            historyDir: '/test/data/history',
            chatsDir: '/test/data/chats',
            cacheDir: '/test/cache',
            logDir: '/test/data/logs',
            userConfigFile: '/test/config/userConfig.yaml',
          },
        })
      }
      return Promise.resolve({ status: 'ok', success: true, result: null })
    }),
    updateConfig: vi.fn(),
  }),
}))

vi.mock('../stores/llm', () => ({
  useLlmStore: () => ({ refreshSecrets: vi.fn() }),
}))

vi.mock('../stores/theme', () => ({ useThemeStore: () => ({}) }))

vi.mock('../plugins', () => ({
  pluginIndexes: [
    () => ({
      name: 'PluginA',
      labelKey: 'plugin.a.label',
      defaultConfig: { fields: [] },
      init: vi.fn(),
    }),
    () => ({
      name: 'PluginB',
      label: 'Plugin B',
      defaultConfig: { fields: [] },
      init: vi.fn(),
    }),
  ],
  usePlugins: () => ({ reloadPlugins: vi.fn() }),
}))

describe('Settings.vue', () => {
  it('places accessibility tab right above plugins tab', () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          Tabs: {
            props: ['tabs'],
            template: `
              <div class="tabs-stub">
                <button v-for="tab in tabs" :key="tab.key" :data-key="tab.key">
                  {{ tab.text }}
                </button>
              </div>
            `,
          },
        },
      },
    })

    const tabKeys = wrapper
      .findAll('.tabs-stub button')
      .map((btn) => btn.attributes('data-key'))

    const accessibilityIdx = tabKeys.indexOf('accessibility')
    const pluginsIdx = tabKeys.indexOf('plugins')

    expect(accessibilityIdx).toBeGreaterThan(-1)
    expect(pluginsIdx).toBeGreaterThan(-1)
    expect(accessibilityIdx).toBe(pluginsIdx - 1)
  })

  it('places translations tab in primary tabs right after llm tab', () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          Tabs: {
            props: ['tabs'],
            template: `
              <div class="tabs-stub">
                <button v-for="tab in tabs" :key="tab.key" :data-key="tab.key">
                  {{ tab.text }}
                </button>
              </div>
            `,
          },
        },
      },
    })

    const tabKeys = wrapper
      .findAll('.tabs-stub button')
      .map((btn) => btn.attributes('data-key'))

    const llmIdx = tabKeys.indexOf('llm')
    const translationsIdx = tabKeys.indexOf('translations')

    expect(llmIdx).toBeGreaterThan(-1)
    expect(translationsIdx).toBeGreaterThan(-1)
    expect(translationsIdx).toBe(llmIdx + 1)
  })

  it('includes hotkeys tab in primary tabs with settings.hotkeysTab text', () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          Tabs: {
            props: ['tabs'],
            template: `
              <div class="tabs-stub">
                <button v-for="tab in tabs" :key="tab.key" :data-key="tab.key">
                  {{ tab.text }}
                </button>
              </div>
            `,
          },
        },
      },
    })

    const hotkeysTab = wrapper.find(
      '.tabs-stub button[data-key="global-actions"]'
    )
    expect(hotkeysTab.exists()).toBe(true)
    expect(hotkeysTab.text()).toBe('settings.hotkeysTab')
  })

  it('renders contrast and motion as FieldSelect controls in accessibility tab', async () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          Tabs: true,
          SettingsSection: {
            props: ['title'],
            template:
              '<section class="settings-section-stub"><slot /></section>',
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
        },
      },
    })

    // Switch to accessibility tab
    const vm = wrapper.vm as any
    vm.currentTab = 'accessibility'
    await wrapper.vm.$nextTick()

    const contrastRow = wrapper.find('[data-label="settings.contrast"]')
    const motionRow = wrapper.find('[data-label="settings.motion"]')

    expect(contrastRow.find('.field-select-stub').exists()).toBe(true)
    expect(motionRow.find('.field-select-stub').exists()).toBe(true)
  })

  it('renders subnav list with plugin items and status badges under plugins tab', () => {
    const wrapper = mount(Settings, { global: { stubs: { Tabs: true } } })

    const subnavItems = wrapper.findAll('.settings-subnav-item')
    expect(subnavItems).toHaveLength(2)

    expect(subnavItems[0].text()).toContain('plugin.a.label')
    expect(
      subnavItems[0].find('.settings-subnav-status.is-enabled').exists()
    ).toBe(true)
    expect(subnavItems[0].text()).toContain('settings.pluginStatusOn')

    expect(subnavItems[1].text()).toContain('Plugin B')
    expect(
      subnavItems[1].find('.settings-subnav-status.is-disabled').exists()
    ).toBe(true)
    expect(subnavItems[1].text()).toContain('settings.pluginStatusOff')
  })

  it('navigates to plugin detail when subnav item is clicked', async () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          Tabs: true,
          SettingsPluginDetailTab: {
            props: ['plugin'],
            template: '<div class="plugin-detail-stub">{{ plugin.name }}</div>',
          },
        },
      },
    })

    const subnavItems = wrapper.findAll('.settings-subnav-item')
    await subnavItems[0].trigger('click')

    const vm = wrapper.vm as any
    expect(vm.currentTab).toBe('plugin:PluginA')
    expect(wrapper.find('.plugin-detail-stub').exists()).toBe(true)
    expect(wrapper.find('.plugin-detail-stub').text()).toBe('PluginA')
  })

  it('renders all storage locations when storage info is loaded', async () => {
    const wrapper = mount(Settings, { global: { stubs: { Tabs: true } } })
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    const storageItems = wrapper.findAll('.storage-item')
    expect(storageItems).toHaveLength(6)

    const labels = storageItems.map((item) =>
      item.find('.storage-item-label').text()
    )
    expect(labels).toEqual([
      'settings.storageUserConfig',
      'settings.storageData',
      'settings.storageHistory',
      'settings.storageChats',
      'settings.storageCache',
      'settings.storageLogs',
    ])
  })
})
