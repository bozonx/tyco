import { ref, type Ref } from 'vue'
import type { AiProfile, ProfileSoul } from '@tyco/shared'

import { isIpcErrorCode } from '../ipc/ipc-model'
import { type ProjectAccessLevel, withProjectAccess } from './project-access'
import { vaultOfRef } from './profile-ref'
import { createWithFreshId } from './vault-id'

export interface AiProfilesModelDependencies {
  listProfiles: () => Promise<AiProfile[]>
  /** The profile as it is on disk now */
  getProfile: (id: string) => Promise<AiProfile>
  createProfile: (profile: AiProfile, soul: string) => Promise<void>
  /**
   * Stores the profile over the file of `expectedRevision`, failing with
   * `staleRevision` when it changed meanwhile; returns the new revision
   */
  saveProfile: (
    profile: AiProfile,
    expectedRevision: string | undefined
  ) => Promise<string>
  deleteProfile: (id: string) => Promise<void>
  readSoul: (id: string) => Promise<ProfileSoul>
  reportError?: (error: unknown) => void
  now?: () => number
  /** The random part of the id of a new profile */
  randomSuffix?: () => string
}

/** What the settings of a profile change */
export type AiProfilePatch = Partial<
  Pick<
    AiProfile,
    | 'name'
    | 'modelId'
    | 'quickRequestModelId'
    | 'temperature'
    | 'maxOutputTokens'
    | 'projectPermissions'
    | 'tools'
    | 'memoryMode'
  >
>

export interface CreateProfileData {
  name: string
  /** The vault the profile goes to; the main one when unset */
  vaultId?: string
  /** The root instruction the profile starts with */
  soul: string
  /** Settings the profile starts with instead of the defaults */
  settings?: Omit<AiProfilePatch, 'name'>
}

export function createAiProfilesModel(deps: AiProfilesModelDependencies) {
  const profiles: Ref<AiProfile[]> = ref([])
  /**
   * Profiles whose save found the file changed on another device or outside
   * TyCo, with the version that was not stored
   */
  const conflicts: Ref<Record<string, AiProfile>> = ref({})
  const now = deps.now ?? (() => Date.now())
  /** Writes of each profile, one after another, so the last change wins */
  const pendingSaves = new Map<string, Promise<void>>()

  const refreshRequests = new Map<string, number>()
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
  const loadProfiles = async (
    isCurrent: () => boolean = () => true
  ): Promise<void> => {
    const request = ++loadRequest
    const wasIdle = pendingMutationCount === 0
    const loaded = (await deps.listProfiles()) ?? []
    if (
      wasIdle &&
      !pendingMutationCount &&
      request === loadRequest &&
      !pendingSaves.size &&
      isCurrent()
    )
      profiles.value = loaded.map(
        (profile) => conflicts.value[profile.id] ?? profile
      )
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
    const created = await createWithFreshId(
      'profile',
      profiles.value.map((p) => p.id),
      async (id) => {
        const newProfile: AiProfile = {
          id,
          name: data.name.trim(),
          memoryMode: 'auto',
          projectPermissions: {},
          // a plain copy: the source may be another profile's reactive state
          ...(data.settings
            ? (JSON.parse(JSON.stringify(data.settings)) as AiProfilePatch)
            : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        await persistChange(() => deps.createProfile(newProfile, data.soul))
        return newProfile
      },
      deps.randomSuffix,
      data.vaultId
    )
    profiles.value = [...profiles.value, created]
    return created
  }

  /**
   * Applies the change at once and stores it after the writes started before,
   * so quick edits never undo one another
   */
  const updateProfile = (id: string, patch: AiProfilePatch): Promise<void> => {
    const current = getProfile(id)
    if (!current) return Promise.resolve()
    ++loadRequest
    replace({ ...current, ...patch, updatedAt: now() })
    const previous = pendingSaves.get(id) ?? Promise.resolve()
    const save = previous
      .catch(() => {})
      .then(async () => {
        const latest = getProfile(id)
        try {
          if (!latest) return
          const { revision: expected, ...stored } = latest
          try {
            const revision = await deps.saveProfile(stored, expected)
            const saved = getProfile(id)
            if (saved) replace({ ...saved, revision })
          } catch (error) {
            if (isIpcErrorCode(error, 'staleRevision'))
              conflicts.value = { ...conflicts.value, [id]: latest }
            throw error
          }
        } finally {
          ++loadRequest
        }
      })
    pendingSaves.set(id, save)
    const cleanup = () => {
      if (pendingSaves.get(id) === save) pendingSaves.delete(id)
    }
    void save.then(cleanup, (error: unknown) => {
      cleanup()
      // a conflict is shown with its own choice, not as a failure
      if (!isIpcErrorCode(error, 'staleRevision')) deps.reportError?.(error)
    })
    return save
  }

  /**
   * Reads the profile from disk, where the user may have edited it; a change
   * not stored yet is kept
   */
  const refreshProfile = async (id: string): Promise<AiProfile | undefined> => {
    if (pendingSaves.has(id)) return getProfile(id)
    const current = getProfile(id)
    const request = (refreshRequests.get(id) ?? 0) + 1
    refreshRequests.set(id, request)
    const stored = await deps.getProfile(id)
    if (
      refreshRequests.get(id) !== request ||
      pendingSaves.has(id) ||
      getProfile(id) !== current ||
      !current
    )
      return getProfile(id)
    ++loadRequest
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
    const { content: soul } = await deps.readSoul(id)
    const { modelId, quickRequestModelId, temperature, maxOutputTokens } =
      source
    return createProfile({
      name,
      // a copy stays in the vault of the original
      vaultId: vaultOfRef(id),
      soul,
      settings: {
        modelId,
        quickRequestModelId,
        temperature,
        maxOutputTokens,
        projectPermissions: source.projectPermissions,
        tools: source.tools,
      },
    })
  }

  const deleteProfile = async (id: string): Promise<void> => {
    await pendingSaves.get(id)?.catch(() => {})
    await persistChange(() => deps.deleteProfile(id))
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

  const forgetConflict = (id: string) => {
    const { [id]: _resolved, ...rest } = conflicts.value
    conflicts.value = rest
  }

  /**
   * Ends a conflict of `id`: takes the profile on disk, or stores the version
   * of this window over it
   */
  const resolveConflict = async (
    id: string,
    keepMine: boolean
  ): Promise<void> => {
    const mine = conflicts.value[id]
    if (!mine) return
    await pendingSaves.get(id)?.catch(() => {})
    const stored = await deps.getProfile(id)
    forgetConflict(id)
    ++loadRequest
    if (!keepMine) {
      replace(stored)
      return
    }
    replace({ ...(getProfile(id) ?? mine), revision: stored.revision })
    await updateProfile(id, {})
  }

  const readSoul = async (id: string): Promise<string> =>
    (await deps.readSoul(id)).content

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
    conflicts,
    resolveConflict,
  }
}
