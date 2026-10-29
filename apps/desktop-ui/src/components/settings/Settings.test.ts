import { SUPPORTED_PLUGIN_LOCALES } from '@tyco/plugin-sdk'
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRoute } from 'vue-router'
import { CONFIG_VERSION } from '@tyco/shared'
import { useSettingsSessionStore } from '../../stores/settings-session'
import SettingsGeneralTab from './SettingsGeneralTab.vue'
import Settings from './Settings.vue'

const settingsMocks = vi.hoisted(() => ({
  configVersion: 0,
  isInDevelopment: true,
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

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastText: vi.fn() }),
}))

vi.mock('../../stores/action-menu', () => ({
  useActionMenuStore: () => ({
    resolveMainActions: (actions: any) => actions ?? [],
    getRegisteredActions: () => [],
  }),
}))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({
    call: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_storage_info') {
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
vi.mock('../../stores/desktop', () => ({
  useDesktopStore: () => ({
    userConfig: {
      configVersion: settingsMocks.configVersion,
      isInDevelopment: settingsMocks.isInDevelopment,
      appearance: { theme: 'auto', contrast: 'normal', motion: 'auto' },
      plugins: {
        PluginA: { isEnabled: true, settings: {} },
        PluginB: { isEnabled: false, settings: {} },
      },
    },
  }),
}))

vi.mock('../../stores/secrets', () => ({
  useSecretsStore: () => ({ refreshSecrets: vi.fn(), secrets: {} }),
}))

vi.mock('../../stores/history', () => ({
  useHistoryStore: () => ({ clearChats: vi.fn() }),
}))

vi.mock('../../stores/theme', () => ({ useThemeStore: () => ({}) }))

vi.mock('../../stores/plugin-runtime', () => ({
  usePluginRuntimeStore: () => ({
    pluginRuntimeStates: {},
    pluginFactories: [
      () => ({
        id: 'PluginA',
        name: 'PluginA',
        version: '1.0.0',
        apiVersion: 2,
        capabilities: [],
        defaultLocale: 'en-US',
        locales: Object.fromEntries(
          SUPPORTED_PLUGIN_LOCALES.map((locale) => [locale, {}])
        ),
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
        defaultLocale: 'en-US',
        locales: Object.fromEntries(
          SUPPORTED_PLUGIN_LOCALES.map((locale) => [locale, {}])
        ),
        label: 'Plugin B',
        defaultConfig: { fields: [] },
        init: vi.fn(),
      }),
    ],
    reloadPlugins: vi.fn(),
    refreshInstalledPlugins: vi.fn(async () => {}),
  }),
}))

async function selectTab(wrapper: VueWrapper, label: string) {
  await wrapper.get(`.navigation-item[aria-label="${label}"]`).trigger('click')
}

describe('Settings.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settingsMocks.configVersion = 0
    settingsMocks.isInDevelopment = true
    delete useRoute().query.tab
  })
  it('falls back from unknown routes and reacts to query changes', async () => {
    useRoute().query.tab = 'unknown'
    const wrapper = mount(Settings, {
      global: { stubs: { NavigationList: false, SettingsChatTab: true } },
    })
    expect(wrapper.get('.navigation-item.is-active').text()).toBe(
      'settings.generalTab'
    )
    useRoute().query.tab = 'chat'
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.navigation-item.is-active').text()).toBe(
      'settings.chat'
    )
    useRoute().query.tab = 'plugin:missing'
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.navigation-item.is-active').text()).toBe(
      'settings.generalTab'
    )
    wrapper.unmount()
  })

  it('disables settings written by a newer version', () => {
    settingsMocks.configVersion = CONFIG_VERSION + 1
    const wrapper = mount(Settings, {
      global: { stubs: { NavigationList: false, Button: true } },
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
          NavigationList: false,
          Button: { template: '<button><slot /></button>' },
        },
      },
    })
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    const session = useSettingsSessionStore()
    session.isSaving = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    session.isSaving = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
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
          NavigationList: false,
          SettingsLlmTab: {
            data: () => ({ keyDraft: '' }),
            template: '<input class="key-draft" v-model="keyDraft" />',
          },
        },
      },
    })
    await selectTab(wrapper, 'settings.llmTab')
    await wrapper.get('.key-draft').setValue('unfinished key')
    useSettingsSessionStore().resolveConflicts(false)
    await wrapper.vm.$nextTick()
    expect((wrapper.get('.key-draft').element as HTMLInputElement).value).toBe(
      ''
    )
    wrapper.unmount()
  })

  it('renders a navigation list per group under its heading', () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          NavigationList: {
            props: ['items'],
            template: `
              <div class="tabs-stub">
                <button v-for="tab in items" :key="tab.id" :data-key="tab.id">
                  {{ tab.name }}
                </button>
              </div>
            `,
          },
        },
      },
    })

    expect(
      wrapper.findAll('.settings-nav-category').map((node) => node.text())
    ).toEqual([
      'settings.aiCategory',
      'settings.actionsCategory',
      'settings.pluginsTab',
    ])
    expect(
      wrapper
        .findAll('.tabs-stub')
        .map((list) =>
          list.findAll('button').map((btn) => btn.attributes('data-key'))
        )
    ).toEqual([
      ['general', 'editor', 'global-actions', 'accessibility'],
      ['llm', 'stt', 'chat', 'translations', 'correction', 'ai-profiles'],
      [
        'main-actions',
        'tasks',
        'transformations',
        'styling',
        'languages',
        'launcher-commands',
        'commands',
      ],
      ['plugins', 'plugin:PluginA', 'plugin:PluginB'],
    ])
  })

  it('places editor tab in primary tabs right after general tab', () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          NavigationList: {
            props: ['items'],
            template: `
              <div class="tabs-stub">
                <button v-for="tab in items" :key="tab.id" :data-key="tab.id">
                  {{ tab.name }}
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

  it('hides editor tab and rejects editor route outside development mode', () => {
    settingsMocks.isInDevelopment = false
    useRoute().query.tab = 'editor'
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          NavigationList: {
            props: ['items'],
            template: `
              <div class="tabs-stub">
                <button v-for="tab in items" :key="tab.id" :data-key="tab.id">
                  {{ tab.name }}
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

    expect(tabKeys).not.toContain('editor')
    expect(wrapper.find('.settings-page-title').exists()).toBe(false)
    expect(wrapper.findComponent(SettingsGeneralTab).exists()).toBe(true)
  })

  it('renders the chat and correction pages from their navigation items', async () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          NavigationList: false,
          SettingsChatTab: { template: '<div class="chat-tab-stub" />' },
          SettingsCorrectionTab: {
            template: '<div class="correction-tab-stub" />',
          },
        },
      },
    })

    await selectTab(wrapper, 'settings.chat')
    expect(wrapper.find('.chat-tab-stub').exists()).toBe(true)
    await selectTab(wrapper, 'settings.correctionTab')
    expect(wrapper.find('.correction-tab-stub').exists()).toBe(true)
  })

  it('includes hotkeys tab in primary tabs with settings.hotkeysTab text', () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          NavigationList: {
            props: ['items'],
            template: `
              <div class="tabs-stub">
                <button v-for="tab in items" :key="tab.id" :data-key="tab.id">
                  {{ tab.name }}
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
          NavigationList: false,
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
            props: ['modelValue', 'options'],
            template:
              '<select class="field-select-stub" :data-val="modelValue" />',
          },
        },
      },
    })

    // Switch to accessibility tab
    await selectTab(wrapper, 'settings.sectionAccessibility')

    const contrastRow = wrapper.find('[data-label="settings.contrast"]')
    const motionRow = wrapper.find('[data-label="settings.motion"]')

    expect(contrastRow.find('.field-select-stub').exists()).toBe(true)
    expect(motionRow.find('.field-select-stub').exists()).toBe(true)
  })

  it('lists each plugin with a status only when it is disabled', () => {
    const wrapper = mount(Settings, {
      global: { stubs: { NavigationList: false } },
    })

    const pluginItems = wrapper
      .findAll('.navigation-item')
      .filter((item) => /plugin\.a\.label|Plugin B/.test(item.text()))
    expect(pluginItems).toHaveLength(2)
    expect(pluginItems[0].find('.navigation-status').exists()).toBe(false)
    expect(pluginItems[1].text()).toContain('settings.pluginStatusOff')
    expect(
      wrapper
        .findAll('.navigation-item')
        .some((item) => item.text() === 'settings.allPluginsTab')
    ).toBe(true)
  })

  it('opens a plugin from its navigation item and returns to all plugins', async () => {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          NavigationList: false,
          SettingsPluginDetailTab: {
            props: ['plugin'],
            template:
              '<div class="plugin-detail-stub">{{ plugin.pluginId }}</div>',
          },
        },
      },
    })
    const item = (text: string) =>
      wrapper.findAll('.navigation-item').find((node) => node.text() === text)!

    expect(wrapper.find('.settings-page-title').exists()).toBe(false)

    await item('plugin.a.label').trigger('click')
    expect(wrapper.get('.plugin-detail-stub').text()).toBe('PluginA')
    expect(wrapper.get('.settings-page-title').text()).toBe('plugin.a.label')
    expect(wrapper.get('.navigation-item.is-active').text()).toBe(
      'plugin.a.label'
    )

    await item('settings.allPluginsTab').trigger('click')
    expect(wrapper.get('.navigation-item.is-active').text()).toBe(
      'settings.allPluginsTab'
    )
    expect(wrapper.find('.plugin-detail-stub').exists()).toBe(false)
    expect(wrapper.find('.settings-page-title').exists()).toBe(false)
  })

  it('remounts SettingsPluginDetailTab with pluginId key when switching plugins', async () => {
    const wrapper = mount(Settings, {
      global: { stubs: { NavigationList: false } },
    })

    await selectTab(wrapper, 'plugin.a.label')

    const detailCardA = wrapper.find('[data-plugin="PluginA"]')
    expect(detailCardA.exists()).toBe(true)
    expect(detailCardA.classes()).not.toContain('is-disabled')

    await selectTab(wrapper, 'Plugin B')

    const detailCardB = wrapper.find('[data-plugin="PluginB"]')
    expect(detailCardB.exists()).toBe(true)
    expect(detailCardB.classes()).toContain('is-disabled')
  })

  it('renders a row per storage root when storage info is loaded', async () => {
    const wrapper = mount(Settings, {
      global: { stubs: { NavigationList: false } },
    })
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    await wrapper.get('.storage-summary').trigger('click')

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
          NavigationList: false,
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
          FieldSwitch: true,
          FieldTextArea: true,
          Button: true,
        },
      },
    })

    await selectTab(wrapper, 'settings.sttNavTab')

    const sections = wrapper.findAll('.settings-section-stub')
    expect(sections).toHaveLength(2)
    expect(sections[0].attributes('data-title')).toBeFalsy()
    expect(sections[1].attributes('data-title')).toBeFalsy()
    expect(
      sections[1].find('[data-label="settings.formatWithLlm"]').exists()
    ).toBe(true)
  })

  it('renders a heading for new profile and new project subpages', () => {
    settingsMocks.isInDevelopment = true
    useRoute().query.tab = 'ai-profile:new'
    const wrapper = mount(Settings, {
      global: {
        stubs: { NavigationList: false, SettingsProfileDetailTab: true },
      },
    })

    expect(wrapper.get('.settings-page-title').text()).toBe(
      'settings.newProfile'
    )
  })
})
