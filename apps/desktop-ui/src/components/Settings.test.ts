import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRoute } from 'vue-router'
import { CONFIG_VERSION } from '@tyco/shared'
import { useSettingsSessionStore } from '../stores/settings-session'
import Settings from './Settings.vue'

const settingsMocks = vi.hoisted(() => ({
  configVersion: 0,
  query: {} as Record<string, string>,
}))

vi.mock(import('vue-router'), async (importOriginal) => {
  const { reactive } = await import('vue')
  const route = reactive({
    query: settingsMocks.query,
    params: {},
    path: '/',
    fullPath: '/',
    name: undefined,
    hash: '',
    matched: [],
    meta: {},
    redirectedFrom: undefined,
  })
  return { ...(await importOriginal()), useRoute: () => route }
})

vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../composables/use-toast', () => ({
  default: () => ({ toastText: vi.fn() }),
}))

vi.mock('../stores/action-menu', () => ({
  useActionMenuStore: () => ({
    clearRegisteredActions: vi.fn(),
    resolveMainActions: (actions: any) => actions ?? [],
    getRegisteredActions: () => [],
  }),
}))

vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({
    desktopState: {
      userConfig: {
        configVersion: settingsMocks.configVersion,
        appearance: { theme: 'auto', contrast: 'normal', motion: 'auto' },

        plugins: { PluginA: { enabled: true }, PluginB: { enabled: false } },
      },
    },
    callFunction: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'getStorageInfo') {
        return Promise.resolve({
          success: true,
          result: {
            locations: [
              { kinds: ['config', 'data'], path: '/test/roaming' },
              { kinds: ['cache', 'logs'], path: '/test/local' },
            ],
          },
        })
      }
      return Promise.resolve({ status: 'ok', success: true, result: null })
    }),
    updateConfig: vi.fn(),
  }),
}))

vi.mock('../stores/llm', () => ({
  useLlmStore: () => ({ refreshSecrets: vi.fn(), secrets: {} }),
}))

vi.mock('../stores/history', () => ({
  useHistoryStore: () => ({ clearChats: vi.fn() }),
}))

vi.mock('../stores/theme', () => ({ useThemeStore: () => ({}) }))

vi.mock('../stores/plugin-runtime', () => ({
  usePluginRuntimeStore: () => ({
    pluginRuntimeStates: {},
    pluginFactories: [
      () => ({
        id: 'PluginA',
        name: 'PluginA',
        version: '1.0.0',
        apiVersion: 2,
        capabilities: [],
        defaultLocale: 'en_US',
        locales: { en_US: {}, ru_RU: {}, es_AR: {}, tr_TR: {} },
        labelKey: 'plugin.a.label',
        defaultConfig: { fields: [] },
        init: vi.fn(),
      }),
      () => ({
        id: 'PluginB',
        name: 'PluginB',
        version: '1.0.0',
        apiVersion: 2,
        capabilities: [],
        defaultLocale: 'en_US',
        locales: { en_US: {}, ru_RU: {}, es_AR: {}, tr_TR: {} },
        label: 'Plugin B',
        defaultConfig: { fields: [] },
        init: vi.fn(),
      }),
    ],
    reloadPlugins: vi.fn(),
    refreshInstalledPlugins: vi.fn(async () => {}),
  }),
}))

describe('Settings.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settingsMocks.configVersion = 0
    delete useRoute().query.tab
  })
  it('falls back from unknown routes and reacts to query changes', async () => {
    useRoute().query.tab = 'unknown'
    const wrapper = mount(Settings, {
      global: { stubs: { Tabs: true, SettingsHistoryTab: true } },
    })
    expect((wrapper.vm as any).currentTab).toBe('general')
    useRoute().query.tab = 'history'
    await wrapper.vm.$nextTick()
    expect((wrapper.vm as any).currentTab).toBe('history')
    useRoute().query.tab = 'plugin:missing'
    await wrapper.vm.$nextTick()
    expect((wrapper.vm as any).currentTab).toBe('general')
    wrapper.unmount()
  })

  it('disables settings written by a newer version', () => {
    settingsMocks.configVersion = CONFIG_VERSION + 1
    const wrapper = mount(Settings, {
      global: { stubs: { Tabs: true, Button: true } },
    })
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'settings.configNewerWarning'
    )
    wrapper.unmount()
  })

  it('shows persistent save status and recovery actions', async () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          Tabs: true,
          Button: { template: '<button><slot /></button>' },
        },
      },
    })
    expect(wrapper.get('[role="status"]').text()).toContain(
      'settings.saveSaved'
    )
    const session = useSettingsSessionStore()
    session.saveError = 'Unavailable'
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('Unavailable')
    expect(wrapper.get('[role="status"]').text()).toContain(
      'settings.saveRetry'
    )
    session.conflicts = ['theme']
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain(
      'settings.saveKeepLocal'
    )
    wrapper.unmount()
  })

  it('discards tab-local drafts when reloading settings', async () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          Tabs: true,
          SettingsLlmTab: {
            data: () => ({ keyDraft: '' }),
            template: '<input class="key-draft" v-model="keyDraft" />',
          },
        },
      },
    })
    ;(wrapper.vm as any).currentTab = 'llm'
    await wrapper.vm.$nextTick()
    await wrapper.get('.key-draft').setValue('unfinished key')
    useSettingsSessionStore().resolveConflicts(false)
    await wrapper.vm.$nextTick()
    expect((wrapper.get('.key-draft').element as HTMLInputElement).value).toBe(
      ''
    )
    wrapper.unmount()
  })

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

  it('places editor tab in primary tabs right after general tab', () => {
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

    const generalIdx = tabKeys.indexOf('general')
    const editorIdx = tabKeys.indexOf('editor')

    expect(generalIdx).toBeGreaterThan(-1)
    expect(editorIdx).toBeGreaterThan(-1)
    expect(editorIdx).toBe(generalIdx + 1)
  })

  it('places history tab in primary tabs right after editor tab', () => {
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

    const editorIdx = tabKeys.indexOf('editor')
    const historyIdx = tabKeys.indexOf('history')

    expect(editorIdx).toBeGreaterThan(-1)
    expect(historyIdx).toBeGreaterThan(-1)
    expect(historyIdx).toBe(editorIdx + 1)

    const historyTab = wrapper.find('.tabs-stub button[data-key="history"]')
    expect(historyTab.text()).toBe('settings.historyTab')
  })

  it('renders SettingsHistoryTab when history tab is active', async () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          Tabs: true,
          SettingsHistoryTab: {
            props: ['userConfig', 'effectiveAppLanguage'],
            template: '<div class="history-tab-stub" />',
          },
        },
      },
    })

    const vm = wrapper.vm as any
    vm.currentTab = 'history'
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.history-tab-stub').exists()).toBe(true)
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

  it('places launcher commands above commands and commands at the very bottom of actions category', () => {
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

    const allTabsContainers = wrapper.findAll('.tabs-stub')
    // Second tabs container is action tabs
    const actionTabKeys = allTabsContainers[1]
      .findAll('button')
      .map((btn) => btn.attributes('data-key'))

    expect(actionTabKeys).toEqual([
      'main-actions',
      'tasks',
      'languages',
      'launcher-commands',
      'commands',
    ])
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
            template:
              '<div class="plugin-detail-stub">{{ plugin.pluginId }}</div>',
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

  it('renders a row per storage root when storage info is loaded', async () => {
    const wrapper = mount(Settings, { global: { stubs: { Tabs: true } } })
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    const storageItems = wrapper.findAll('.storage-item')
    expect(storageItems).toHaveLength(2)

    const labels = storageItems.map((item) =>
      item.find('.storage-item-label').text()
    )
    expect(labels).toEqual([
      'settings.storageConfig · settings.storageData settings.storageDataHint',
      'settings.storageCache · settings.storageLogs',
    ])
    expect(storageItems[1].find('.storage-path').text()).toBe('/test/local')

    const firstItemButtons = storageItems[0].findAll(
      '.storage-path-actions .storage-copy-btn'
    )
    expect(firstItemButtons).toHaveLength(2)
    expect(firstItemButtons[0].attributes('aria-label')).toBe(
      'settings.storageCopyPath'
    )
    expect(firstItemButtons[1].attributes('aria-label')).toBe(
      'settings.storageOpenFolder'
    )
  })

  it('renders stt provider and llm formatting sections in stt tab', async () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          Tabs: true,
          SettingsSection: {
            props: ['title'],
            template:
              '<section class="settings-section-stub" :data-title="title"><slot /></section>',
          },
          FieldRow: {
            props: ['label'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: true,
          FieldInput: true,
          FieldCheckbox: true,
          FieldTextArea: true,
          Button: true,
        },
      },
    })

    const vm = wrapper.vm as any
    vm.currentTab = 'stt'
    await wrapper.vm.$nextTick()

    const sections = wrapper.findAll('.settings-section-stub')
    expect(sections).toHaveLength(2)
    expect(sections[0].attributes('data-title')).toBeFalsy()
    expect(sections[1].attributes('data-title')).toBe(
      'settings.sttLlmFormatting'
    )
    expect(
      sections[1].find('[data-label="settings.formatWithLlm"]').exists()
    ).toBe(true)
  })
})
