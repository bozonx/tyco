import { describe, expect, it, vi } from 'vitest'
import type { AiProject } from '@tyco/shared'
import { IpcCallError } from '../ipc/ipc-model'
import { createAiProjectsModel } from './ai-projects-model'

describe('ai-projects-model', () => {
  const mockProject: AiProject = {
    id: 'docs-app',
    name: 'Documentation App',
    description: 'Markdown docs',
    isExternal: false,
    targetPath: undefined,
    createdAt: 1000,
    updatedAt: 1000,
  }

  const createDeps = () => ({
    listProjects: vi.fn().mockResolvedValue([mockProject]),
    createProject: vi.fn().mockResolvedValue('r1'),
    saveProject: vi.fn().mockResolvedValue('r2'),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    pickExternalFolder: vi.fn().mockResolvedValue('/path/to/folder'),
    now: vi.fn().mockReturnValue(2000),
    randomSuffix: () => 'abcd1234',
  })

  it('ignores older list responses and invalidated loads', async () => {
    const deps = createDeps()
    let resolveOld!: (items: never[]) => void
    deps.listProjects.mockImplementationOnce(
      () =>
        new Promise<never[]>((resolve) => {
          resolveOld = resolve
        })
    )
    const model = createAiProjectsModel(deps)
    const oldLoad = model.loadProjects()
    await model.loadProjects()
    const current = model.projects.value
    resolveOld([])
    await oldLoad
    expect(model.projects.value).toBe(current)
    deps.listProjects.mockResolvedValue([])
    await model.loadProjects(() => false)
    expect(model.projects.value).toBe(current)
  })

  it.each(['create', 'update', 'delete'] as const)(
    'keeps a %s over an older list response',
    async (operation) => {
      const deps = createDeps()
      const model = createAiProjectsModel(deps)
      await model.loadProjects()
      let resolveList!: (items: AiProject[]) => void
      deps.listProjects.mockImplementationOnce(
        () =>
          new Promise<AiProject[]>((resolve) => {
            resolveList = resolve
          })
      )
      const load = model.loadProjects()
      if (operation === 'create') {
        await model.createProject({ name: 'New', isExternal: false })
      } else if (operation === 'update') {
        await model.saveProject({ ...mockProject, name: 'Updated' })
      } else {
        await model.deleteProject('docs-app')
      }
      resolveList([mockProject])
      await load
      if (operation === 'create')
        expect(model.projects.value.map((item) => item.name)).toContain('New')
      else if (operation === 'update')
        expect(model.getProject('docs-app')?.name).toBe('Updated')
      else expect(model.projects.value).toEqual([])
    }
  )

  it('does not apply a list read during creation', async () => {
    const deps = createDeps()
    const model = createAiProjectsModel(deps)
    await model.loadProjects()
    let finishCreate!: (revision: string) => void
    deps.createProject.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishCreate = resolve
        })
    )
    const creating = model.createProject({ name: 'New', isExternal: false })
    const created = { ...mockProject, id: 'project-abcd1234', name: 'New' }
    let resolveList!: (items: AiProject[]) => void
    deps.listProjects.mockImplementationOnce(
      () =>
        new Promise<AiProject[]>((resolve) => {
          resolveList = resolve
        })
    )
    const loading = model.loadProjects()
    resolveList([mockProject, created])
    await loading
    finishCreate('r1')
    await creating
    expect(
      model.projects.value.filter((item) => item.id === 'project-abcd1234')
    ).toHaveLength(1)
  })

  it('allows loading again after a failed mutation', async () => {
    const deps = createDeps()
    const model = createAiProjectsModel(deps)
    deps.deleteProject.mockRejectedValueOnce(new Error('disk error'))
    await expect(model.deleteProject('docs-app')).rejects.toThrow('disk error')
    await model.loadProjects()
    expect(model.projects.value).toEqual([mockProject])
  })

  it('loads projects into state', async () => {
    const deps = createDeps()
    const model = createAiProjectsModel(deps)
    await model.loadProjects()

    expect(deps.listProjects).toHaveBeenCalledOnce()
    expect(model.projects.value).toEqual([mockProject])
    expect(model.getProject('docs-app')).toEqual(mockProject)
  })

  it('creates an internal project', async () => {
    const deps = createDeps()
    const model = createAiProjectsModel(deps)
    model.projects.value = [mockProject]

    const created = await model.createProject({
      name: 'Backend API',
      description: 'API code',
      isExternal: false,
    })

    expect(created.id).toBe('project-abcd1234')
    expect(created.isExternal).toBe(false)
    expect(created.targetPath).toBeUndefined()
    const { revision: _revision, ...input } = created
    expect(deps.createProject).toHaveBeenCalledWith(input)
    expect(model.projects.value).toContainEqual(created)
  })

  it('takes another id when the folder is there already', async () => {
    const deps = createDeps()
    deps.createProject.mockRejectedValueOnce(
      new IpcCallError('Project already exists', 'alreadyExists')
    )
    let suffix = 0
    const model = createAiProjectsModel({
      ...deps,
      randomSuffix: () => `0000000${++suffix}`,
    })

    const created = await model.createProject({
      name: 'Backend API',
      isExternal: false,
    })
    expect(created.id).toBe('project-00000002')
  })

  it('creates an external project with target path', async () => {
    const deps = createDeps()
    const model = createAiProjectsModel(deps)

    const created = await model.createProject({
      name: 'External Docs',
      isExternal: true,
      targetPath: '/home/user/docs',
    })

    expect(created.isExternal).toBe(true)
    expect(created.targetPath).toBe('/home/user/docs')
    const { revision: _revision, ...input } = created
    expect(deps.createProject).toHaveBeenCalledWith(input)
  })

  it('updates an existing project', async () => {
    const deps = createDeps()
    const model = createAiProjectsModel(deps)
    model.projects.value = [mockProject]

    await model.saveProject({
      ...mockProject,
      name: 'Updated Documentation App',
    })

    expect(deps.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Updated Documentation App',
        updatedAt: 2000,
      }),
      undefined
    )
    expect(model.getProject('docs-app')?.revision).toBe('r2')
  })

  it('keeps a project changed elsewhere until the user decides', async () => {
    const deps = createDeps()
    deps.saveProject.mockRejectedValueOnce(
      new IpcCallError('changed', 'staleRevision')
    )
    const model = createAiProjectsModel(deps)
    model.projects.value = [{ ...mockProject, revision: 'r1' }]
    await expect(
      model.saveProject({ ...mockProject, revision: 'r1', name: 'Mine' })
    ).rejects.toThrow('changed')
    expect(model.conflicts.value['docs-app']?.name).toBe('Mine')

    deps.listProjects.mockResolvedValueOnce([
      { ...mockProject, name: 'Remote', revision: 'remote' },
    ])
    await model.resolveConflict('docs-app', true)
    expect(deps.saveProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Mine' }),
      'remote'
    )
    expect(model.conflicts.value).toEqual({})
  })

  it('deletes a project and removes it from state', async () => {
    const deps = createDeps()
    const model = createAiProjectsModel(deps)
    model.projects.value = [mockProject]

    await model.deleteProject('docs-app')
    expect(deps.deleteProject).toHaveBeenCalledWith('docs-app')
    expect(model.projects.value).toEqual([])
  })

  it('picks external folder via dependency', async () => {
    const deps = createDeps()
    const model = createAiProjectsModel(deps)

    const picked = await model.pickExternalFolder()
    expect(picked).toBe('/path/to/folder')
    expect(deps.pickExternalFolder).toHaveBeenCalledOnce()
  })
})
