import { ref, type Ref } from 'vue'
import type { AiProject } from '@tyco/shared'

import { createVaultId } from './vault-id'

export interface AiProjectsModelDependencies {
  listProjects: () => Promise<AiProject[]>
  createProject: (project: AiProject) => Promise<void>
  saveProject: (project: AiProject) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  pickExternalFolder: () => Promise<string | null>
  now?: () => number
  randomSuffix?: () => string
}

export interface CreateProjectData {
  name: string
  description?: string
  isExternal: boolean
  targetPath?: string
}

export function createAiProjectsModel(deps: AiProjectsModelDependencies) {
  const projects: Ref<AiProject[]> = ref([])
  const now = deps.now ?? (() => Date.now())

  let loadRequest = 0
  const loadProjects = async (
    isCurrent: () => boolean = () => true
  ): Promise<void> => {
    const request = ++loadRequest
    const loaded = (await deps.listProjects()) ?? []
    if (request === loadRequest && isCurrent()) projects.value = loaded
  }

  const getProject = (id: string): AiProject | undefined => {
    return projects.value.find((p) => p.id === id)
  }

  const createProject = async (data: CreateProjectData): Promise<AiProject> => {
    const id = createVaultId(
      data.name,
      'project',
      projects.value.map((p) => p.id),
      deps.randomSuffix
    )
    const timestamp = now()
    const newProject: AiProject = {
      id,
      name: data.name.trim(),
      description: data.description?.trim(),
      isExternal: data.isExternal,
      targetPath: (data.isExternal && data.targetPath?.trim()) || undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await deps.createProject(newProject)
    projects.value = [...projects.value, newProject]
    return newProject
  }

  const saveProject = async (project: AiProject): Promise<void> => {
    const updated: AiProject = { ...project, updatedAt: now() }
    await deps.saveProject(updated)
    projects.value = projects.value.map((p) =>
      p.id === updated.id ? updated : p
    )
  }

  const deleteProject = async (id: string): Promise<void> => {
    await deps.deleteProject(id)
    projects.value = projects.value.filter((p) => p.id !== id)
  }

  const pickExternalFolder = (): Promise<string | null> =>
    deps.pickExternalFolder()

  return {
    projects,
    loadProjects,
    getProject,
    createProject,
    saveProject,
    deleteProject,
    pickExternalFolder,
  }
}

export type AiProjectsModel = ReturnType<typeof createAiProjectsModel>
