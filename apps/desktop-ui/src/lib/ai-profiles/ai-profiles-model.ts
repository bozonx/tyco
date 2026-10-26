import { ref, type Ref } from 'vue'
import type { AiProfile } from '@tyco/shared'

import { type ProjectAccessLevel, withProjectAccess } from './project-access'
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

/** What the settings of a profile change */
export type AiProfilePatch = Partial<
  Pick<
    AiProfile,
    | 'name'
    | 'icon'
    | 'modelId'
    | 'temperature'
    | 'maxOutputTokens'
    | 'projectPermissions'
    | 'tools'
  >
>

export interface CreateProfileData {
  name: string
  /** The folder; one is made from the name when unset */
  id?: string
  /** The root instruction the profile starts with */
  soul: string
  /** Settings the profile starts with instead of the defaults */
  settings?: Omit<AiProfilePatch, 'name'>
}

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
      id:
        data.id ||
        createVaultId(
          data.name,
          'profile',
          profiles.value.map((p) => p.id),
          deps.randomSuffix
        ),
      name: data.name.trim(),
      projectPermissions: {},
      // a plain copy: the source may be another profile's reactive state
      ...(data.settings
        ? (JSON.parse(JSON.stringify(data.settings)) as AiProfilePatch)
        : {}),
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

  /**
   * A new profile with the settings and root instruction of `id`; its chats and
   * files stay with the original
   */
  const duplicateProfile = async (
    id: string,
    name: string
  ): Promise<AiProfile> => {
    const source = getProfile(id)
    if (!source) throw new Error(`Profile not found: ${id}`)
    const soul = await deps.readSoul(id)
    const { icon, modelId, temperature, maxOutputTokens } = source
    return createProfile({
      name,
      soul,
      settings: {
        icon,
        modelId,
        temperature,
        maxOutputTokens,
        projectPermissions: source.projectPermissions,
        tools: source.tools,
      },
    })
  }

  const deleteProfile = async (id: string): Promise<void> => {
    await pendingSaves.get(id)?.catch(() => {})
    await deps.deleteProfile(id)
    profiles.value = profiles.value.filter((p) => p.id !== id)
  }

  /** Connects the profile to a project at `level`, or disconnects it */
  const setProjectAccess = (
    profileId: string,
    projectId: string,
    level: ProjectAccessLevel | undefined
  ): Promise<void> => {
    const profile = getProfile(profileId)
    if (!profile) return Promise.resolve()
    return updateProfile(profileId, {
      projectPermissions: withProjectAccess(
        profile.projectPermissions,
        projectId,
        level
      ),
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
    duplicateProfile,
    deleteProfile,
    setProjectAccess,
    readSoul,
    writeSoul,
  }
}

export type AiProfilesModel = ReturnType<typeof createAiProfilesModel>
