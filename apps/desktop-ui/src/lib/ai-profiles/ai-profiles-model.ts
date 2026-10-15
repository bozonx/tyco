import { ref, type Ref } from 'vue'
import type { AiProfile, ProjectPermission } from '@tyco/shared'

export interface AiProfilesModelDependencies {
  listProfiles: () => Promise<AiProfile[]>
  saveProfile: (profile: AiProfile) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  readSoul: (id: string) => Promise<string>
  writeSoul: (id: string, content: string) => Promise<void>
  now?: () => number
}

export interface CreateProfileData {
  id?: string
  name: string
  icon?: string
  lastModelId?: string
  projectPermissions?: Record<string, ProjectPermission>
}

export function createAiProfilesModel(deps: AiProfilesModelDependencies) {
  const profiles: Ref<AiProfile[]> = ref([])
  const now = deps.now ?? (() => Date.now())

  const loadProfiles = async (): Promise<void> => {
    profiles.value = (await deps.listProfiles()) ?? []
  }

  const getProfile = (id: string): AiProfile | undefined => {
    return profiles.value.find((p) => p.id === id)
  }

  const generateProfileId = (name: string): string => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const base = slug || 'profile'
    let candidate = base
    let counter = 1
    while (profiles.value.some((p) => p.id === candidate)) {
      candidate = `${base}-${counter++}`
    }
    return candidate
  }

  const createProfile = async (data: CreateProfileData): Promise<AiProfile> => {
    const id = data.id?.trim() || generateProfileId(data.name)
    const timestamp = now()
    const newProfile: AiProfile = {
      id,
      name: data.name.trim(),
      icon: data.icon,
      lastModelId: data.lastModelId,
      projectPermissions: data.projectPermissions ?? {},
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await deps.saveProfile(newProfile)
    profiles.value = [...profiles.value, newProfile]
    return newProfile
  }

  const saveProfile = async (profile: AiProfile): Promise<void> => {
    const updated: AiProfile = { ...profile, updatedAt: now() }
    await deps.saveProfile(updated)
    profiles.value = profiles.value.map((p) =>
      p.id === updated.id ? updated : p
    )
  }

  const deleteProfile = async (id: string): Promise<void> => {
    await deps.deleteProfile(id)
    profiles.value = profiles.value.filter((p) => p.id !== id)
  }

  const updateLastModel = async (
    profileId: string,
    modelId: string
  ): Promise<void> => {
    const profile = getProfile(profileId)
    if (!profile) return
    if (profile.lastModelId === modelId) return
    await saveProfile({ ...profile, lastModelId: modelId })
  }

  const setProjectPermission = async (
    profileId: string,
    projectId: string,
    permission: ProjectPermission
  ): Promise<void> => {
    const profile = getProfile(profileId)
    if (!profile) return
    const updatedPermissions = {
      ...profile.projectPermissions,
      [projectId]: permission,
    }
    await saveProfile({ ...profile, projectPermissions: updatedPermissions })
  }

  const readSoul = (id: string): Promise<string> => deps.readSoul(id)
  const writeSoul = (id: string, content: string): Promise<void> =>
    deps.writeSoul(id, content)

  return {
    profiles,
    loadProfiles,
    getProfile,
    createProfile,
    saveProfile,
    deleteProfile,
    updateLastModel,
    setProjectPermission,
    readSoul,
    writeSoul,
  }
}

export type AiProfilesModel = ReturnType<typeof createAiProfilesModel>
