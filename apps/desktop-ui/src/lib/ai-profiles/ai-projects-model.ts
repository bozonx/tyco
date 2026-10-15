import { ref, type Ref } from 'vue'
import type { AiProject } from '@tyco/shared'

export interface AiProjectsModelDependencies {
  listProjects: () => Promise<AiProject[]>
  saveProject: (project: AiProject) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  pickExternalFolder: () => Promise<string | null>
  now?: () => number
}

export interface CreateProjectData {
  id?: string
  name: string
  description?: string
  isExternal: boolean
  targetPath?: string | null
}

export function createAiProjectsModel(deps: AiProjectsModelDependencies) {
  const projects: Ref<AiProject[]> = ref([])
  const now = deps.now ?? (() => Date.now())

  const loadProjects = async (): Promise<void> => {
    projects.value = (await deps.listProjects()) ?? []
  }

  const getProject = (id: string): AiProject | undefined => {
    return projects.value.find((p) => p.id === id)
  }

  const generateProjectId = (name: string): string => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const base = slug || 'project'
    let candidate = base
    let counter = 1
    while (projects.value.some((p) => p.id === candidate)) {
      candidate = `${base}-${counter++}`
    }
    return candidate
  }

  const createProject = async (data: CreateProjectData): Promise<AiProject> => {
    const id = data.id?.trim() || generateProjectId(data.name)
    const timestamp = now()
    const newProject: AiProject = {
      id,
      name: data.name.trim(),
      description: data.description?.trim(),
      isExternal: data.isExternal,
      targetPath: data.isExternal ? data.targetPath?.trim() || null : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await deps.saveProject(newProject)
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
