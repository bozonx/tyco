import type { AiProfile, AiProject } from '@tyco/shared'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { IpcCallError } from '../ipc/ipc-model'
import { createAiProfilesModel } from './ai-profiles-model'
import { createAiProjectsModel } from './ai-projects-model'
import { createProfileEditor } from './profile-editor'
import { createProjectEditor } from './project-editor'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const project: AiProject = {
  id: 'project-a',
  name: 'Old',
  description: 'Old description',
  isExternal: false,
  createdAt: 1,
  updatedAt: 1,
  revision: 'r1',
}
const profile: AiProfile = {
  id: 'profile-a',
  name: 'Old',
  temperature: 0.5,
  memoryMode: 'auto',
  projectPermissions: {},
  createdAt: 1,
  updatedAt: 1,
  revision: 'r1',
}

function projects() {
  let disk = { ...project }
  const saveProject = vi.fn(async (value: AiProject, expected?: string) => {
    if (expected !== disk.revision)
      throw new IpcCallError('changed', 'staleRevision')
    disk = { ...value, revision: `${disk.revision}-next` }
    return disk.revision!
  })
  const model = createAiProjectsModel({
    listProjects: async () => [disk],
    createProject: async () => 'created',
    saveProject,
    convertProject: async () => 'r',
    deleteProject: async () => {},
    pickExternalFolder: async () => null,
  })
  const editor = createProjectEditor({
    saveProject: async (fields, revision) =>
      model.saveProject({
        ...model.getProject(project.id)!,
        ...fields,
        revision,
      }),
    reportError: () => {},
  })
  return {
    model,
    editor,
    saveProject,
    remote: () => {
      disk = { ...disk, description: 'Remote', revision: 'r2' }
    },
    disk: () => disk,
  }
}

it('keeps the revision of dirty project fields across a watcher reload', async () => {
  const { model, editor, remote, disk, saveProject } = projects()
  await model.loadProjects()
  editor.load(model.getProject(project.id))
  editor.name.value = 'Local'
  editor.change()
  remote()
  await model.loadProjects()
  editor.syncFromStored(model.getProject(project.id)!)
  expect(await editor.flush()).toBe(false)
  expect(saveProject).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Local' }),
    'r1'
  )
  expect(disk().description).toBe('Remote')
  expect(model.conflicts.value[project.id]).toBeDefined()

  const stored = await model.resolveConflict(project.id, true)
  editor.load(stored)
  editor.name.value = 'Local again'
  editor.change()
  expect(await editor.flush()).toBe(true)
  expect(disk().name).toBe('Local again')
})

it('refreshes clean project fields and uses the returned revision on successive saves', async () => {
  const { model, editor, remote, disk } = projects()
  await model.loadProjects()
  editor.load(model.getProject(project.id))
  remote()
  await model.loadProjects()
  editor.syncFromStored(model.getProject(project.id)!)
  expect(editor.description.value).toBe('Remote')
  for (const name of ['First', 'Second']) {
    editor.name.value = name
    editor.change()
    expect(await editor.flush()).toBe(true)
  }
  expect(disk()).toMatchObject({ name: 'Second', description: 'Remote' })
})

it('does not replace the revision of pending profile edits with a watcher revision', async () => {
  let disk = { ...profile }
  const saveProfile = vi.fn(async (value: AiProfile, expected?: string) => {
    if (expected !== disk.revision)
      throw new IpcCallError('changed', 'staleRevision')
    disk = { ...value, revision: `${disk.revision}-next` }
    return disk.revision!
  })
  const model = createAiProfilesModel({
    listProfiles: async () => [disk],
    getProfile: async () => disk,
    createProfile: async () => 'created',
    saveProfile,
    deleteProfile: async () => {},
    readSoul: async () => ({ content: '', revision: '' }),
  })
  await model.loadProfiles()
  const editor = createProfileEditor({
    getProfile: () => model.getProfile(profile.id),
    updateProfile: (patch, expected) =>
      model.updateProfile(profile.id, patch, expected),
    readSoul: async () => ({ content: '', revision: '' }),
    writeSoul: async () => 's1',
    hasProfileConflict: () => Boolean(model.conflicts.value[profile.id]),
    resolveProfileConflict: (keep) => model.resolveConflict(profile.id, keep),
    reportError: () => {},
  })
  await editor.load(model.getProfile(profile.id)!)
  editor.name.value = 'Local'
  editor.changeName()
  disk = { ...disk, temperature: 1.5, revision: 'r2' }
  await model.loadProfiles()
  await editor.syncFromStored(model.getProfile(profile.id)!)
  expect(await editor.flush()).toBe(false)
  expect(saveProfile).toHaveBeenCalledWith(expect.anything(), 'r1')
  expect(disk.temperature).toBe(1.5)
  expect(editor.hasConflict.value).toBe(true)
  await editor.resolveConflict(false)
  expect(editor.temperatureText.value).toBe('1.5')
  editor.name.value = 'Next'
  editor.changeName()
  expect(await editor.flush()).toBe(true)
})

it('checks the creation revision on the first profile and project edits', async () => {
  const stale = async (_value: unknown, expected?: string) => {
    expect(expected).toBe('created')
    throw new IpcCallError('changed', 'staleRevision')
  }
  const profiles = createAiProfilesModel({
    listProfiles: async () => [],
    getProfile: async () => profile,
    createProfile: async () => 'created',
    saveProfile: stale,
    deleteProfile: async () => {},
    readSoul: async () => ({ content: '', revision: '' }),
    randomSuffix: () => '00000001',
  })
  const createdProfile = await profiles.createProfile({ name: 'New', soul: '' })
  await expect(
    profiles.updateProfile(createdProfile.id, { name: 'Edited' })
  ).rejects.toThrow('changed')
  const projects = createAiProjectsModel({
    listProjects: async () => [],
    createProject: async () => 'created',
    saveProject: stale,
    convertProject: async () => 'r',
    deleteProject: async () => {},
    pickExternalFolder: async () => null,
    randomSuffix: () => '00000001',
  })
  const createdProject = await projects.createProject({
    name: 'New',
    isExternal: false,
  })
  await expect(
    projects.saveProject({ ...createdProject, name: 'Edited' })
  ).rejects.toThrow('changed')
})
