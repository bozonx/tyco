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
    createProfile: vi.fn(async ({ name }: { name: string }) => ({
      id: 'created-profile',
      name,
    })),
    createProject: vi.fn(async ({ name }: { name: string }) => ({
      id: 'created-project',
      name,
    })),
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
          SettingsCreateEntityModal: {
            name: 'SettingsCreateEntityModal',
            props: ['open', 'title', 'label', 'confirmText', 'isSubmitting'],
            emits: ['close', 'submit'],
            template:
              '<div class="create-entity-modal" :data-title="title" :data-open="open" />',
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

  it('describes each profile by its tools and opens it', async () => {
    store.profiles.push(
      profile({}),
      profile({
        id: 'coder',
        name: 'Coder',
        tools: { groups: { files: { isEnabled: true, access: 'allow' } } },
      })
    )
    const wrapper = mountTab()
    const items = wrapper.findAllComponents({ name: 'SettingsEntityItem' })
    expect(items[0]!.text()).toContain('settings.profileNoTools')
    expect(items[1]!.text()).toContain('chatTools.files')
    await items[0]!.vm.$emit('open')
    expect(context.navigate).toHaveBeenCalledWith('ai-profile:writer')
  })

  it('describes each project by its assigned profiles', () => {
    store.profiles.push(
      profile({
        id: 'writer',
        name: 'Writer',
        projectPermissions: { 'proj-1': { read: 'allow', write: 'allow' } },
      })
    )
    store.projects.push(
      { id: 'proj-1', name: 'Project 1' },
      { id: 'proj-2', name: 'Project 2' }
    )
    const wrapper = mountTab()
    const items = wrapper.findAllComponents({ name: 'SettingsEntityItem' })
    expect(items[1]!.text()).toContain('Writer')
    expect(items[2]!.text()).toContain('settings.noProfilesWithAccess')
  })

  it('creates and opens a new profile through the modal', async () => {
    const wrapper = mountTab()
    const modals = wrapper.findAllComponents({
      name: 'SettingsCreateEntityModal',
    })
    const profileModal = modals[0]!
    expect(profileModal.props('open')).toBe(false)

    await button(wrapper, 'settings.newProfile').trigger('click')
    expect(profileModal.props('open')).toBe(true)

    await profileModal.vm.$emit('submit', 'New Writer')
    await flushPromises()

    expect(store.createProfile).toHaveBeenCalledWith({
      name: 'New Writer',
      soul: expect.any(String),
      settings: {},
    })
    expect(context.navigate).toHaveBeenCalledWith('ai-profile:created-profile')
    expect(profileModal.props('open')).toBe(false)
  })

  it('creates and opens a new project through the modal', async () => {
    const wrapper = mountTab()
    const modals = wrapper.findAllComponents({
      name: 'SettingsCreateEntityModal',
    })
    const projectModal = modals[1]!
    expect(projectModal.props('open')).toBe(false)

    await button(wrapper, 'settings.newProject').trigger('click')
    expect(projectModal.props('open')).toBe(true)

    await projectModal.vm.$emit('submit', 'New Workspace')
    await flushPromises()

    expect(store.createProject).toHaveBeenCalledWith({
      name: 'New Workspace',
      isExternal: false,
    })
    expect(context.navigate).toHaveBeenCalledWith('ai-project:created-project')
    expect(projectModal.props('open')).toBe(false)
  })

  it('reports creation errors without closing modal', async () => {
    store.createProfile.mockRejectedValueOnce(
      new Error('Profile creation failed')
    )
    const wrapper = mountTab()
    const modals = wrapper.findAllComponents({
      name: 'SettingsCreateEntityModal',
    })
    const profileModal = modals[0]!

    await button(wrapper, 'settings.newProfile').trigger('click')
    await profileModal.vm.$emit('submit', 'Bad Profile')
    await flushPromises()

    expect(toastError.mock.calls).toEqual([
      [new Error('Profile creation failed')],
    ])
    expect(profileModal.props('open')).toBe(true)
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
    expect((items[1] as { danger?: boolean }).danger).toBeFalsy()

    await items[0]!.action()
    const duplicateConfirm = wrapper.get(
      '[data-title="settings.duplicateProfile"]'
    )
    expect(duplicateConfirm.attributes('data-open')).toBe('true')
    await duplicateConfirm.get('.confirm-yes').trigger('click')
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
    expect((menuItems[0] as { danger?: boolean }).danger).toBeFalsy()

    await menuItems[0]!.action()
    await flushPromises()
    const confirm = wrapper.get('[data-title="settings.deleteProject"]')
    expect(confirm.attributes('data-open')).toBe('true')
    await confirm.get('.confirm-yes').trigger('click')
    await flushPromises()
    expect(store.deleteProject).toHaveBeenCalledWith('proj-1')
  })
})
