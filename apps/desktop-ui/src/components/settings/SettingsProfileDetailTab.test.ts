import { flushPromises, mount } from '@vue/test-utils'
import {
  DEFAULT_USER_CONFIG,
  type AiProfile,
  type AiProject,
} from '@tyco/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsProfileDetailTab from './SettingsProfileDetailTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastError }),
}))

const profiles = vi.hoisted(() => ({ store: null as unknown }))
vi.mock('../../stores/ai-profiles', () => ({
  useAiProfilesStore: () => profiles.store,
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

const profile = (): AiProfile => ({
  id: 'writer',
  name: 'Writer',
  modelId: 'removed-model',
  projectPermissions: {},
  createdAt: 1,
  updatedAt: 1,
})

function createStore() {
  const state = reactive({
    profiles: [profile()] as AiProfile[],
    projects: [] as AiProject[],
    isLoaded: true,
  })
  return Object.assign(state, {
    getProfile: (id: string) => state.profiles.find((item) => item.id === id),
    createProfile: vi.fn(async () => ({ id: 'created' })),
    duplicateProfile: vi.fn(async () => ({ id: 'copy' })),
    updateProfile: vi.fn(async () => {}),
    readSoul: vi.fn(async () => 'Be kind'),
    writeSoul: vi.fn(async () => {}),
    refreshProfile: vi.fn(async () => undefined),
    openVaultDir: vi.fn(async () => {}),
    countChats: vi.fn(async () => 3),
    deleteProfile: vi.fn(async () => {}),
  })
}

describe('SettingsProfileDetailTab.vue', () => {
  let store: ReturnType<typeof createStore>
  let context: ReturnType<typeof createTestSettingsContext>
  beforeEach(() => {
    store = createStore()
    profiles.store = store
    context = createTestSettingsContext()
  })
  afterEach(() => toastError.mockReset())

  const mountTab = (profileId = 'writer') =>
    mount(SettingsProfileDetailTab, {
      props: { profileId },
      global: {
        provide: context.provide,
        stubs: {
          SettingsProfileToolsSection: true,
          ConfirmModal: {
            props: ['open', 'message'],
            template:
              '<div v-if="open" class="confirm">{{ message }}<button class="confirm-yes" @click="$emit(\'confirm\')" /></div>',
          },
        },
      },
    })

  const button = (wrapper: ReturnType<typeof mountTab>, label: string) =>
    wrapper.findAll('button').find((item) => item.text().includes(label))!

  it('creates a profile and opens it', async () => {
    const wrapper = mountTab('new')
    await wrapper.get('input').setValue('Editor')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('profiles/editor')
    expect(store.createProfile).toHaveBeenCalledWith({
      name: 'Editor',
      id: 'editor',
      soul: 'settings.profileDefaultSoul',
      settings: {},
    })
    expect(context.navigate).toHaveBeenCalledWith('ai-profile:created')
  })

  it('connects projects and warns while the file tools are off', async () => {
    store.projects.push(
      {
        id: 'docs',
        name: 'Docs',
        isExternal: false,
        createdAt: 1,
        updatedAt: 1,
      },
      { id: 'site', name: 'Site', isExternal: true, createdAt: 1, updatedAt: 1 }
    )
    store.profiles[0]!.projectPermissions = {
      docs: { read: 'allow', write: 'deny' },
    }
    const wrapper = mountTab()
    await flushPromises()
    expect(wrapper.text()).toContain('settings.profileFileToolsOff')
    const list = wrapper.findComponent({ name: 'SettingsAccessList' })
    expect(list.props('entries')).toEqual([
      expect.objectContaining({ id: 'docs', level: 'read' }),
    ])
    expect(list.props('candidates')).toEqual([
      expect.objectContaining({ id: 'site' }),
    ])
    await list.vm.$emit('change', 'site', 'full')
    expect(store.updateProfile).toHaveBeenLastCalledWith('writer', {
      projectPermissions: {
        docs: { read: 'allow', write: 'deny' },
        site: { read: 'allow', write: 'allow' },
      },
    })
    await list.vm.$emit('open', 'docs')
    expect(context.navigate).toHaveBeenCalledWith('ai-project:docs')
  })

  it('refuses a folder another profile has', async () => {
    const wrapper = mountTab('new')
    const [nameInput, folderInput] = wrapper.findAll('input')
    await nameInput!.setValue('Editor')
    await folderInput!.setValue('Writer')
    expect(wrapper.text()).toContain('settings.vaultFolderTaken')
    await wrapper.get('form').trigger('submit')
    expect(store.createProfile).not.toHaveBeenCalled()
  })

  it('shows the folder of an existing profile', async () => {
    const wrapper = mountTab()
    await flushPromises()
    expect(wrapper.text()).toContain('profiles/writer')
  })

  it('reports a failed creation', async () => {
    store.createProfile.mockRejectedValueOnce(new Error('Disk full'))
    const wrapper = mountTab('new')
    await wrapper.get('input').setValue('Editor')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith(new Error('Disk full'))
    expect(context.navigate).not.toHaveBeenCalled()
  })

  it('toggles advanced settings for temperature and max tokens', async () => {
    const wrapper = mountTab()
    await flushPromises()
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)
    await button(wrapper, 'settings.showAdvanced').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('input[type="number"]').length).toBe(2)
  })

  it('counts the chats before deleting the profile', async () => {
    const wrapper = mountTab()
    await flushPromises()
    await wrapper
      .findComponent({ name: 'SettingsDangerZone' })
      .vm.$emit('action')
    await flushPromises()
    expect(wrapper.get('.confirm').text()).toContain(
      'settings.deleteProfileConfirm:{"name":"Writer","count":3}'
    )
    await wrapper.get('.confirm-yes').trigger('click')
    await flushPromises()
    expect(store.deleteProfile).toHaveBeenCalledWith('writer')
    expect(context.navigate).toHaveBeenCalledWith('ai-profiles:overview')
  })

  it('warns when the chats could not be counted', async () => {
    store.countChats.mockRejectedValueOnce(new Error('Locked'))
    const wrapper = mountTab()
    await flushPromises()
    await wrapper
      .findComponent({ name: 'SettingsDangerZone' })
      .vm.$emit('action')
    await flushPromises()
    expect(wrapper.get('.confirm').text()).toContain(
      'settings.deleteProfileConfirmUncounted'
    )
  })

  it('opens the profile folder and reports failures', async () => {
    store.openVaultDir.mockRejectedValueOnce(new Error('No folder'))
    const wrapper = mountTab()
    await flushPromises()
    await button(wrapper, 'settings.openProfileFolder').trigger('click')
    await flushPromises()
    expect(store.openVaultDir).toHaveBeenCalledWith('writer')
    expect(toastError).toHaveBeenCalledWith(new Error('No folder'))
  })

  it('rereads the profile when the window comes back', async () => {
    mountTab()
    await flushPromises()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(store.refreshProfile).toHaveBeenCalledWith('writer')
  })

  it('tells when the profile does not exist', () => {
    const wrapper = mountTab('missing')
    expect(wrapper.text()).toContain('settings.profileNotFound')
  })
})
