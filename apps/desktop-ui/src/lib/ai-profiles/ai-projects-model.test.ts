import { describe, expect, it, vi } from 'vitest'
import type { AiProject } from '@tyco/shared'
import { createAiProjectsModel } from './ai-projects-model'

describe('ai-projects-model', () => {
  const mockProject: AiProject = {
    id: 'docs-app',
    name: 'Documentation App',
    description: 'Markdown docs',
    isExternal: false,
    targetPath: null,
    createdAt: 1000,
    updatedAt: 1000,
  }

  const createDeps = () => ({
    listProjects: vi.fn().mockResolvedValue([mockProject]),
    createProject: vi.fn().mockResolvedValue(undefined),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    pickExternalFolder: vi.fn().mockResolvedValue('/path/to/folder'),
    now: vi.fn().mockReturnValue(2000),
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

    expect(created.id).toBe('backend-api')
    expect(created.isExternal).toBe(false)
    expect(created.targetPath).toBeNull()
    expect(deps.createProject).toHaveBeenCalledWith(created)
    expect(model.projects.value).toContainEqual(created)
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
    expect(deps.createProject).toHaveBeenCalledWith(created)
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
      })
    )
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
