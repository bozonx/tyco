import { ref, type Ref } from 'vue'
import type { AiProfile, ProjectPermission } from '@tyco/shared'

import { createVaultId } from './vault-id'

export interface AiProfilesModelDependencies {
  listProfiles: () => Promise<AiProfile[]>
  /** The profile as it is on disk now */
  getProfile: (id: string) => Promise<AiProfile>
  createProfile: (profile: AiProfile, soul: string) => Promise<void>
  saveProfile: (profile: AiProfile) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  readSoul: (id: string) => Promise<string>
  writeSoul: (id: string, content: string) => Promise<void>
  reportError?: (error: unknown) => void
  now?: () => number
  /** A random suffix for an id the name gives none for */
  randomSuffix?: () => string
}

export interface CreateProfileData {
  name: string
  /** The root instruction the profile starts with */
  soul: string
}

/** What the settings of a profile change */
export type AiProfilePatch = Partial<
  Pick<
    AiProfile,
    | 'name'
    | 'modelId'
    | 'temperature'
    | 'maxOutputTokens'
    | 'projectPermissions'
    | 'tools'
  >
>

export function createAiProfilesModel(deps: AiProfilesModelDependencies) {
  const profiles: Ref<AiProfile[]> = ref([])
  const now = deps.now ?? (() => Date.now())
  /** Writes of each profile, one after another, so the last change wins */
  const pendingSaves = new Map<string, Promise<void>>()

  let loadRequest = 0
  const loadProfiles = async (
    isCurrent: () => boolean = () => true
  ): Promise<void> => {
    const request = ++loadRequest
    const loaded = (await deps.listProfiles()) ?? []
    if (request === loadRequest && isCurrent()) profiles.value = loaded
  }

  const getProfile = (id: string): AiProfile | undefined => {
    return profiles.value.find((p) => p.id === id)
  }

  const replace = (profile: AiProfile) => {
    profiles.value = profiles.value.map((p) =>
      p.id === profile.id ? profile : p
    )
  }

  const createProfile = async (data: CreateProfileData): Promise<AiProfile> => {
    const timestamp = now()
    const newProfile: AiProfile = {
      id: createVaultId(
        data.name,
        'profile',
        profiles.value.map((p) => p.id),
        deps.randomSuffix
      ),
      name: data.name.trim(),
      projectPermissions: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await deps.createProfile(newProfile, data.soul)
    profiles.value = [...profiles.value, newProfile]
    return newProfile
  }

  /**
   * Applies the change at once and stores it after the writes started before,
   * so quick edits never undo one another
   */
  const updateProfile = (id: string, patch: AiProfilePatch): Promise<void> => {
    const current = getProfile(id)
    if (!current) return Promise.resolve()
    replace({ ...current, ...patch, updatedAt: now() })
    const previous = pendingSaves.get(id) ?? Promise.resolve()
    const save = previous
      .catch(() => {})
      .then(async () => {
        const latest = getProfile(id)
        if (latest) await deps.saveProfile(latest)
      })
    pendingSaves.set(id, save)
    const cleanup = () => {
      if (pendingSaves.get(id) === save) pendingSaves.delete(id)
    }
    void save.then(cleanup, (error: unknown) => {
      cleanup()
      deps.reportError?.(error)
    })
    return save
  }

  /**
   * Reads the profile from disk, where the user may have edited it; a change
   * not stored yet is kept
   */
  const refreshProfile = async (id: string): Promise<AiProfile | undefined> => {
    if (pendingSaves.has(id)) return getProfile(id)
    const stored = await deps.getProfile(id)
    if (pendingSaves.has(id) || !getProfile(id)) return getProfile(id)
    replace(stored)
    return stored
  }

  const deleteProfile = async (id: string): Promise<void> => {
    await pendingSaves.get(id)?.catch(() => {})
    await deps.deleteProfile(id)
    profiles.value = profiles.value.filter((p) => p.id !== id)
  }

  const setProjectPermission = (
    profileId: string,
    projectId: string,
    permission: ProjectPermission
  ): Promise<void> => {
    const profile = getProfile(profileId)
    if (!profile) return Promise.resolve()
    return updateProfile(profileId, {
      projectPermissions: {
        ...profile.projectPermissions,
        [projectId]: permission,
      },
    })
  }

  const readSoul = (id: string): Promise<string> => deps.readSoul(id)
  const writeSoul = (id: string, content: string): Promise<void> =>
    deps.writeSoul(id, content)

  return {
    profiles,
    loadProfiles,
    getProfile,
    createProfile,
    updateProfile,
    refreshProfile,
    deleteProfile,
    setProjectPermission,
    readSoul,
    writeSoul,
  }
}

export type AiProfilesModel = ReturnType<typeof createAiProfilesModel>
