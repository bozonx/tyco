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
// the page has no settings session here: its draft is saved when it unmounts
vi.mock('../../composables/use-settings-draft', async () => {
  const { onBeforeUnmount } = await import('vue')
  return {
    useSettingsDraft: (flush: () => Promise<boolean>) =>
      onBeforeUnmount(() => void flush()),
  }
})
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
  memoryMode: 'auto',
  projectPermissions: permissions,
  // the file tools are off, so the access does nothing yet
  tools: {
    sources: { 'core:files': { isEnabled: false } },
    tools: {},
    commandIds: [],
  },
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
    projectConflicts: {} as Record<string, unknown>,
    resolveProjectConflict: vi.fn(async () => undefined),
    createProject: vi.fn(async () => ({ id: 'created' })),
    deleteProject: vi.fn(async () => {}),
    convertProject: vi.fn(
      async (id: string, options: { targetPath?: string }) => {
        const converted = {
          ...state.projects.find((item) => item.id === id)!,
          isExternal: true,
          targetPath: options.targetPath,
        }
        state.projects = [converted]
        return { project: converted, isSourceLeft: false }
      }
    ),
    inspectProjectTransfer: vi.fn(),
    openProjectFolder: vi.fn(async () => {}),
    pickFolder: vi.fn(async (): Promise<string | null> => '/work'),
    setProjectAccess: vi.fn(async () => {}),
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
      attachTo: document.body,
      props: { projectId },
      global: {
        provide: context.provide,
        stubs: {
          SettingsProjectConvertDialog: true,
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
    await wrapper.get('[data-testid="project-folder-pick"]').trigger('click')
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

  it('submits the form and blocks repeated creation while access is granted', async () => {
    store.profiles.push(profile({}))
    let finish!: () => void
    store.setProjectAccess.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const wrapper = mountTab('new')
    await wrapper.get('input').setValue('Docs')
    await wrapper
      .findComponent({ name: 'FieldCheckbox' })
      .vm.$emit('update:modelValue', true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(
      button(wrapper, 'settings.saveProject').attributes('disabled')
    ).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(store.createProject).toHaveBeenCalledOnce()
    expect(context.navigate).not.toHaveBeenCalled()
    finish()
    await flushPromises()
    expect(context.navigate).toHaveBeenCalledWith('ai-project:created')
  })

  it('explains why an invalid project cannot be saved', async () => {
    // the folder of a stored project is set on each device: one without it
    // here is told so, not refused
    store.projects[0]!.isExternal = true
    const wrapper = mountTab()
    await wrapper.get('input').setValue('')
    expect(wrapper.text()).toContain('settings.projectNameRequired')
    expect(wrapper.text()).not.toContain('settings.projectPathRequired')
    expect(wrapper.text()).toContain('settings.projectFolderNotSetOnDevice')
    wrapper.unmount()
    await flushPromises()
    expect(store.saveProject).not.toHaveBeenCalled()
  })

  it('shows the type and folder of a project in one field', async () => {
    const internal = mountTab()
    const field = internal.get('[data-testid="project-folder"]')
    expect(field.find('[data-testid="project-type"]').exists()).toBe(false)
    expect(field.text()).toContain('projects/notes')
    expect(field.text()).toContain('settings.projectConvertToExternal')
    expect(field.find('[data-testid="project-folder-pick"]').exists()).toBe(
      false
    )
    expect(internal.findComponent({ name: 'SegmentedControl' }).exists()).toBe(
      false
    )
    await internal.findComponent({ name: 'PathDisplay' }).vm.$emit('open')
    expect(store.openProjectFolder).toHaveBeenCalledWith('notes')
    internal.unmount()

    store.projects[0]!.isExternal = true
    store.projects[0]!.targetPath = '/work'
    const external = mountTab()
    const externalField = external.get('[data-testid="project-folder"]')
    expect(externalField.get('[data-testid="project-type"]').text()).toBe(
      'settings.projectBadgeExternal'
    )
    expect(externalField.text()).not.toContain('projects/notes')
    expect(externalField.text()).toContain('/work')
    expect(externalField.text()).toContain('settings.projectConvertToInternal')
    expect(
      externalField.get('[data-testid="project-folder-pick"]').text()
    ).toBe('settings.projectFolderChange')
    expect(
      external.findComponent({ name: 'PathDisplay' }).props('canOpen')
    ).toBe(true)
  })

  it('relinks an external project to another folder without converting it', async () => {
    store.projects[0]!.isExternal = true
    store.projects[0]!.targetPath = '/work'
    store.pickFolder.mockResolvedValueOnce('/elsewhere')
    const wrapper = mountTab()
    await wrapper.get('[data-testid="project-folder-pick"]').trigger('click')
    await flushPromises()
    // a folder not stored yet cannot be opened
    expect(
      wrapper.findComponent({ name: 'PathDisplay' }).props('canOpen')
    ).toBe(false)
    wrapper.unmount()
    await flushPromises()
    expect(store.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ targetPath: '/elsewhere', isExternal: true })
    )
    expect(store.convertProject).not.toHaveBeenCalled()
  })

  it('converts an existing project through its dialog', async () => {
    const wrapper = mountTab()
    await wrapper.get('[data-testid="project-convert"]').trigger('click')
    const dialog = wrapper.findComponent({
      name: 'SettingsProjectConvertDialog',
    })
    expect(dialog.props()).toMatchObject({
      open: true,
      toExternal: true,
      hasSourceFolder: false,
    })
    const options = {
      targetPath: '/work',
      transferFiles: false,
      trashSource: false,
    }
    await dialog.vm.$emit('confirm', options)
    await flushPromises()
    expect(store.convertProject).toHaveBeenCalledWith('notes', options)
    expect(dialog.props('open')).toBe(false)
    expect(wrapper.text()).not.toContain('projects/notes')
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

  it('flushes the latest typed fields before saving mine after a conflict', async () => {
    store.projectConflicts.notes = project()
    const wrapper = mountTab()
    await wrapper.get('input').setValue('Latest local name')
    await button(wrapper, 'settings.conflictKeepMine').trigger('click')
    await flushPromises()
    expect(store.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Latest local name' })
    )
    expect(store.resolveProjectConflict).toHaveBeenCalledWith('notes', true)
    expect(store.saveProject.mock.invocationCallOrder[0]).toBeLessThan(
      store.resolveProjectConflict.mock.invocationCallOrder[0]!
    )
    wrapper.unmount()
  })

  it('shows the profiles with access without changing them', async () => {
    store.profiles.push(
      profile({ notes: { read: 'allow', write: 'ask', delete: 'ask' } }),
      { ...profile({}), id: 'reader', name: 'Reader' }
    )
    const wrapper = mountTab()
    // the access is shown here and changed on the page of the profile
    const items = wrapper
      .findAllComponents({ name: 'SettingsEntityItem' })
      .filter((item) => item.props('title') === 'Writer')
    expect(items).toHaveLength(1)
    expect(items[0]!.props('description')).toBe(
      'settings.projectAccessFileToolsOff'
    )
    expect(items[0]!.text()).toContain('settings.accessLevelReadWrite')
    expect(wrapper.text()).not.toContain('Reader')
    expect(wrapper.findComponent({ name: 'FieldSelect' }).exists()).toBe(false)
    items[0]!.vm.$emit('open')
    expect(store.setProjectAccess).not.toHaveBeenCalled()
    expect(context.navigate).toHaveBeenCalledWith('ai-profile:writer')
  })

  it('grants the chosen access when a new project is created', async () => {
    store.profiles.push(profile({}))
    const wrapper = mountTab('new')
    await wrapper.get('input').setValue('Docs')
    const checkbox = wrapper.findComponent({ name: 'FieldCheckbox' })
    await checkbox.vm.$emit('update:modelValue', true)
    expect(checkbox.props('modelValue')).toBe(true)
    expect(store.setProjectAccess).not.toHaveBeenCalled()
    await button(wrapper, 'settings.saveProject').trigger('click')
    await flushPromises()
    expect(store.setProjectAccess).toHaveBeenCalledWith(
      'writer',
      'created',
      'read'
    )
    expect(context.navigate).toHaveBeenCalledWith('ai-project:created')
  })

  it('reports a folder that could not be picked', async () => {
    store.projects[0]!.isExternal = true
    store.pickFolder.mockRejectedValueOnce(new Error('Denied'))
    const wrapper = mountTab()
    await wrapper.get('[data-testid="project-folder-pick"]').trigger('click')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith(new Error('Denied'))
  })

  it('tells when the project does not exist', () => {
    expect(mountTab('missing').text()).toContain('settings.projectNotFound')
  })
})
