import { ref, type Ref } from 'vue'
import type { AiProject } from '@tyco/shared'

import { isIpcErrorCode } from '../ipc/ipc-model'
import { createWithFreshId } from './vault-id'

export interface AiProjectsModelDependencies {
  listProjects: () => Promise<AiProject[]>
  createProject: (project: AiProject) => Promise<void>
  /**
   * Stores the project over the file of `expectedRevision`, failing with
   * `staleRevision` when it changed meanwhile; returns the new revision
   */
  saveProject: (
    project: AiProject,
    expectedRevision: string | undefined
  ) => Promise<string>
  deleteProject: (id: string) => Promise<void>
  pickExternalFolder: () => Promise<string | null>
  now?: () => number
  randomSuffix?: () => string
}

export interface CreateProjectData {
  name: string
  /** The vault the project goes to; the main one when unset */
  vaultId?: string
  description?: string
  isExternal: boolean
  targetPath?: string
}

export function createAiProjectsModel(deps: AiProjectsModelDependencies) {
  const projects: Ref<AiProject[]> = ref([])
  /** Projects whose save found the file changed elsewhere, as not stored */
  const conflicts: Ref<Record<string, AiProject>> = ref({})
  const now = deps.now ?? (() => Date.now())

  let loadRequest = 0
  let pendingMutationCount = 0
  const persistChange = async (persist: () => Promise<void>): Promise<void> => {
    ++loadRequest
    ++pendingMutationCount
    try {
      await persist()
    } finally {
      --pendingMutationCount
      ++loadRequest
    }
  }
  const loadProjects = async (
    isCurrent: () => boolean = () => true
  ): Promise<void> => {
    const request = ++loadRequest
    const wasIdle = pendingMutationCount === 0
    const loaded = (await deps.listProjects()) ?? []
    if (
      wasIdle &&
      !pendingMutationCount &&
      request === loadRequest &&
      isCurrent()
    )
      projects.value = loaded.map(
        (project) => conflicts.value[project.id] ?? project
      )
  }

  const getProject = (id: string): AiProject | undefined => {
    return projects.value.find((p) => p.id === id)
  }

  const createProject = async (data: CreateProjectData): Promise<AiProject> => {
    const timestamp = now()
    const created = await createWithFreshId(
      'project',
      projects.value.map((p) => p.id),
      async (id) => {
        const newProject: AiProject = {
          id,
          name: data.name.trim(),
          description: data.description?.trim(),
          isExternal: data.isExternal,
          targetPath: (data.isExternal && data.targetPath?.trim()) || undefined,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        await persistChange(() => deps.createProject(newProject))
        return newProject
      },
      deps.randomSuffix,
      data.vaultId
    )
    projects.value = [...projects.value, created]
    return created
  }

  const saveProject = async (project: AiProject): Promise<void> => {
    const { revision: expected, ...rest } = project
    const updated: AiProject = { ...rest, updatedAt: now() }
    let revision = ''
    try {
      await persistChange(async () => {
        revision = await deps.saveProject(updated, expected)
      })
    } catch (error) {
      if (isIpcErrorCode(error, 'staleRevision'))
        conflicts.value = { ...conflicts.value, [project.id]: project }
      throw error
    }
    const saved = { ...updated, revision }
    projects.value = projects.value.map((p) => (p.id === saved.id ? saved : p))
  }

  /**
   * Ends a conflict of `id`: takes the project on disk, or stores the version
   * of this window over it. Returns the project as it is now
   */
  const resolveConflict = async (
    id: string,
    keepMine: boolean
  ): Promise<AiProject | undefined> => {
    const mine = conflicts.value[id]
    if (!mine) return getProject(id)
    const stored = (await deps.listProjects()).find((p) => p.id === id)
    const { [id]: _resolved, ...rest } = conflicts.value
    conflicts.value = rest
    if (!stored) return undefined
    if (!keepMine) {
      projects.value = projects.value.map((p) => (p.id === id ? stored : p))
      return stored
    }
    await saveProject({ ...mine, revision: stored.revision })
    return getProject(id)
  }

  const deleteProject = async (id: string): Promise<void> => {
    await persistChange(() => deps.deleteProject(id))
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
    conflicts,
    resolveConflict,
  }
}
