import { flushPromises, mount } from '@vue/test-utils'
import type { AiProfile, AiProject } from '@tyco/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsProjectDetailTab from './SettingsProjectDetailTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastError }),
}))

const projects = vi.hoisted(() => ({ store: null as unknown }))
vi.mock('../../stores/ai-profiles', () => ({
  useAiProfilesStore: () => projects.store,
}))

const project = (): AiProject => ({
  id: 'notes',
  name: 'Notes',
  isExternal: false,
  createdAt: 1,
  updatedAt: 1,
})
const profile = (permissions: AiProfile['projectPermissions']): AiProfile => ({
  id: 'writer',
  name: 'Writer',
  projectPermissions: permissions,
  createdAt: 1,
  updatedAt: 1,
})

function createStore() {
  const state = reactive({
    projects: [project()] as AiProject[],
    profiles: [] as AiProfile[],
    isLoaded: true,
  })
  return Object.assign(state, {
    getProject: (id: string) => state.projects.find((item) => item.id === id),
    saveProject: vi.fn(async () => {}),
    createProject: vi.fn(async () => ({ id: 'created' })),
    deleteProject: vi.fn(async () => {}),
    pickFolder: vi.fn(async (): Promise<string | null> => '/work'),
  })
}

describe('SettingsProjectDetailTab.vue', () => {
  let store: ReturnType<typeof createStore>
  let context: ReturnType<typeof createTestSettingsContext>
  beforeEach(() => {
    store = createStore()
    projects.store = store
    context = createTestSettingsContext()
  })
  afterEach(() => toastError.mockReset())

  const mountTab = (projectId = 'notes') =>
    mount(SettingsProjectDetailTab, {
      props: { projectId },
      global: {
        provide: context.provide,
        stubs: {
          ConfirmModal: {
            props: ['open'],
            template:
              '<button v-if="open" class="confirm-yes" @click="$emit(\'confirm\')" />',
          },
        },
      },
    })

  const button = (wrapper: ReturnType<typeof mountTab>, label: string) =>
    wrapper.findAll('button').find((item) => item.text().includes(label))!

  it('creates an external project with a picked folder', async () => {
    const wrapper = mountTab('new')
    await wrapper.get('input').setValue('Docs')
    await wrapper
      .findComponent({ name: 'SegmentedControl' })
      .vm.$emit('update:modelValue', 'external')
    await button(wrapper, 'settings.selectFolder').trigger('click')
    await flushPromises()
    await button(wrapper, 'settings.saveProject').trigger('click')
    await flushPromises()
    expect(store.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Docs',
        isExternal: true,
        targetPath: '/work',
      })
    )
    expect(store.saveProject).not.toHaveBeenCalled()
    expect(context.navigate).toHaveBeenCalledWith('ai-project:created')
  })

  it('stores an edited project', async () => {
    const wrapper = mountTab()
    await wrapper.get('input').setValue('Renamed')
    wrapper.unmount()
    await flushPromises()
    expect(store.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notes', name: 'Renamed' })
    )
  })

  it('shows the access of each profile', () => {
    store.profiles.push(profile({ notes: { read: 'allow', write: 'ask' } }), {
      ...profile({}),
      id: 'reader',
      name: 'Reader',
    })
    const wrapper = mountTab()
    const items = wrapper.findAllComponents({ name: 'SettingsEntityItem' })
    expect(items[0]!.text()).toContain('settings.accessAllow')
    expect(items[0]!.text()).toContain('settings.accessAsk')
    expect(items[1]!.text()).toContain('settings.accessDeny')
  })

  it('reports a folder that could not be picked', async () => {
    store.projects[0]!.isExternal = true
    store.pickFolder.mockRejectedValueOnce(new Error('Denied'))
    const wrapper = mountTab()
    await button(wrapper, 'settings.selectFolder').trigger('click')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith(new Error('Denied'))
  })

  it('deletes the project and returns to the overview', async () => {
    const wrapper = mountTab()
    await wrapper
      .findComponent({ name: 'SettingsDangerZone' })
      .vm.$emit('action')
    await wrapper.get('.confirm-yes').trigger('click')
    await flushPromises()
    expect(store.deleteProject).toHaveBeenCalledWith('notes')
    expect(context.navigate).toHaveBeenCalledWith('ai-profiles:overview')
  })

  it('reports a failed deletion', async () => {
    store.deleteProject.mockRejectedValueOnce(new Error('Busy'))
    const wrapper = mountTab()
    await wrapper
      .findComponent({ name: 'SettingsDangerZone' })
      .vm.$emit('action')
    await wrapper.get('.confirm-yes').trigger('click')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith(new Error('Busy'))
  })

  it('tells when the project does not exist', () => {
    expect(mountTab('missing').text()).toContain('settings.projectNotFound')
  })
})
