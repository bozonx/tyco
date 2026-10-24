import { flushPromises, mount } from '@vue/test-utils'
import { DEFAULT_USER_CONFIG, type AiProfile } from '@tyco/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsAiProfilesTab from './SettingsAiProfilesTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastError }),
}))

const vault = vi.hoisted(() => ({ store: null as unknown }))
vi.mock('../../stores/ai-profiles', () => ({
  useAiProfilesStore: () => vault.store,
}))
vi.mock('../../stores/secrets', () => ({
  useSecretsStore: () => ({ secrets: {} }),
}))
vi.mock('../../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../../test/desktop-store')
  return {
    useDesktopStore: () =>
      mockDesktopStore(() => ({ userConfig: DEFAULT_USER_CONFIG })),
  }
})

const profile = (fields: Partial<AiProfile>): AiProfile => ({
  id: 'writer',
  name: 'Writer',
  projectPermissions: {},
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

function createStore() {
  return reactive({
    profiles: [] as AiProfile[],
    projects: [] as Array<Record<string, unknown>>,
    vaultPath: '/vault',
    vaultError: '',
    loadAll: vi.fn(async () => {}),
    openVaultDir: vi.fn(async () => {}),
    pickFolder: vi.fn(async (): Promise<string | null> => '/elsewhere'),
  })
}

describe('SettingsAiProfilesTab.vue', () => {
  let store: ReturnType<typeof createStore>
  let context: ReturnType<typeof createTestSettingsContext>
  beforeEach(() => {
    store = createStore()
    vault.store = store
    context = createTestSettingsContext()
  })
  afterEach(() => toastError.mockReset())

  const mountTab = () =>
    mount(SettingsAiProfilesTab, { global: { provide: context.provide } })
  const button = (wrapper: ReturnType<typeof mountTab>, label: string) =>
    wrapper.findAll('button').find((item) => item.text().includes(label))!

  it('loads the vault and tells when it is empty', () => {
    const wrapper = mountTab()
    expect(store.loadAll).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('settings.noProfilesYet')
    expect(wrapper.text()).toContain('settings.noProjectsYet')
  })

  it('describes each profile by its model and opens it', async () => {
    store.profiles.push(
      profile({}),
      profile({ id: 'gone', name: 'Gone', modelId: 'removed' })
    )
    const wrapper = mountTab()
    const items = wrapper.findAllComponents({ name: 'SettingsEntityItem' })
    expect(items[0]!.text()).toContain('settings.profileModelDefault')
    expect(items[1]!.text()).toContain(
      'removed (settings.profileModelUnavailable)'
    )
    await items[0]!.vm.$emit('open')
    expect(context.navigate).toHaveBeenCalledWith('ai-profile:writer')
  })

  it('opens new profiles and projects', async () => {
    const wrapper = mountTab()
    await button(wrapper, 'settings.newProfile').trigger('click')
    await button(wrapper, 'settings.newProject').trigger('click')
    expect(vi.mocked(context.navigate).mock.calls).toEqual([
      ['ai-profile:new'],
      ['ai-project:new'],
    ])
  })

  it('moves the vault to a picked folder and back to the default', async () => {
    const wrapper = mountTab()
    await button(wrapper, 'settings.selectFolder').trigger('click')
    await flushPromises()
    expect(context.draft.value.aiVault.path).toBe('/elsewhere')
    await button(wrapper, 'settings.resetToDefault').trigger('click')
    expect(context.draft.value.aiVault.path).toBe('')
  })

  it('reports vault folder failures', async () => {
    store.openVaultDir.mockRejectedValueOnce(new Error('Missing'))
    store.pickFolder.mockRejectedValueOnce(new Error('Denied'))
    const wrapper = mountTab()
    await button(wrapper, 'settings.openInFileManager').trigger('click')
    await button(wrapper, 'settings.selectFolder').trigger('click')
    await flushPromises()
    expect(toastError.mock.calls).toEqual([
      [new Error('Missing')],
      [new Error('Denied')],
    ])
  })
})
