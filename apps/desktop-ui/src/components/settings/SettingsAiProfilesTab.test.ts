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
    duplicateProfile: vi.fn(async () => ({ id: 'writer-copy' })),
    countChats: vi.fn(async () => 5),
    deleteProfile: vi.fn(async () => {}),
    deleteProject: vi.fn(async () => {}),
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
    mount(SettingsAiProfilesTab, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsVaultLocationModal: {
            name: 'SettingsVaultLocationModal',
            props: ['open', 'currentPath', 'isCustom'],
            template: '<div />',
          },
          ConfirmModal: {
            name: 'ConfirmModal',
            props: ['open', 'message', 'title'],
            template:
              '<div class="confirm-modal" :data-title="title" :data-open="open"><button class="confirm-yes" @click="$emit(\'confirm\')" /></div>',
          },
        },
      },
    })
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

  it('changes the vault folder in a dialog, never in the draft', async () => {
    const wrapper = mountTab()
    const modal = wrapper.findComponent({ name: 'SettingsVaultLocationModal' })
    expect(modal.props('open')).toBe(false)
    await button(wrapper, 'settings.vaultChange').trigger('click')
    expect(modal.props('open')).toBe(true)
    expect(modal.props('currentPath')).toBe('/vault')
    await modal.vm.$emit('close')
    expect(modal.props('open')).toBe(false)
    expect(context.draft.value.aiVault.path).toBe('')
  })

  it('reports a vault folder that cannot be opened', async () => {
    store.openVaultDir.mockRejectedValueOnce(new Error('Missing'))
    const wrapper = mountTab()
    await button(wrapper, 'settings.openInFileManager').trigger('click')
    await flushPromises()
    expect(toastError.mock.calls).toEqual([[new Error('Missing')]])
  })

  it('duplicates and deletes a profile through its menu', async () => {
    store.profiles.push(profile({ id: 'writer', name: 'Writer' }))
    const wrapper = mountTab()
    const item = wrapper.findComponent({ name: 'SettingsEntityItem' })
    const menu = item.findComponent({ name: 'DropdownMenu' })
    const items = menu.props('items') as Array<{
      label: string
      action: () => void
    }>
    expect(items.map((i) => i.label)).toEqual([
      'settings.duplicateProfile',
      'common.delete',
    ])

    await items[0]!.action()
    await flushPromises()
    expect(store.duplicateProfile).toHaveBeenCalledWith(
      'writer',
      expect.any(String)
    )
    expect(context.navigate).toHaveBeenCalledWith('ai-profile:writer-copy')

    await items[1]!.action()
    await flushPromises()
    expect(store.countChats).toHaveBeenCalledWith('writer')
    const confirm = wrapper.get('[data-title="settings.deleteProfile"]')
    expect(confirm.attributes('data-open')).toBe('true')
    await confirm.get('.confirm-yes').trigger('click')
    await flushPromises()
    expect(store.deleteProfile).toHaveBeenCalledWith('writer')
  })

  it('deletes a project through its menu', async () => {
    store.projects.push({ id: 'proj-1', name: 'Project 1' })
    const wrapper = mountTab()
    const items = wrapper.findAllComponents({ name: 'SettingsEntityItem' })
    const projectItem = items[0]!
    const menu = projectItem.findComponent({ name: 'DropdownMenu' })
    const menuItems = menu.props('items') as Array<{
      label: string
      action: () => void
    }>
    expect(menuItems.map((i) => i.label)).toEqual(['common.delete'])

    await menuItems[0]!.action()
    await flushPromises()
    const confirm = wrapper.get('[data-title="settings.deleteProject"]')
    expect(confirm.attributes('data-open')).toBe('true')
    await confirm.get('.confirm-yes').trigger('click')
    await flushPromises()
    expect(store.deleteProject).toHaveBeenCalledWith('proj-1')
  })
})
