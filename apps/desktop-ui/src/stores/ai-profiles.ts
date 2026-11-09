import { DESKTOP_EVENTS, type VaultFolder, type VaultInfo } from '@tyco/shared'

import { clientLogger } from '../lib/logger'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, readonly, ref, watch } from 'vue'
import { desktopClient } from '../lib/desktop/client'

import { describeError } from '../lib/errors/describe-error'
import { translate } from '../lib/i18n'
import { createAiProfilesModel } from '../lib/ai-profiles/ai-profiles-model'
import { createAiProjectsModel } from '../lib/ai-profiles/ai-projects-model'
import { createProfileChatsModel } from '../lib/ai-profiles/profile-chats'
import { createIpcChatSessionStorageDriver } from '../lib/chat/chat-session-storage'
import { resultOrThrow } from '../lib/ipc/ipc-model'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'

export const useAiProfilesStore = defineStore('ai-profiles', () => {
  const ipcStore = useIpcStore()
  const call = ipcStore.call
  const desktopStore = useDesktopStore()

  const profilesModel = createAiProfilesModel({
    reportError: (error) =>
      clientLogger.error('Could not save AI profile', error, 'ai-profiles'),
    listProfiles: async () => resultOrThrow(await call('list_ai_profiles')),
    getProfile: async (id) =>
      resultOrThrow(await call('get_ai_profile', { id })),
    createProfile: async (profile, soul) => {
      resultOrThrow(await call('create_ai_profile', { profile, soul }))
    },
    saveProfile: async (profile, expectedRevision) =>
      resultOrThrow(
        await call('save_ai_profile', { profile, expectedRevision })
      ),
    deleteProfile: async (id) => {
      resultOrThrow(await call('delete_ai_profile', { id }))
    },
    readSoul: async (id) =>
      resultOrThrow(await call('read_ai_profile_soul', { id })),
  })

  /** `SOUL.md` of the profile with its revision, empty for no file */
  const readSoulWithRevision = async (id: string) =>
    resultOrThrow(await call('read_ai_profile_soul', { id }))

  /** Writes `SOUL.md` over the file of `expectedRevision`; the new revision */
  const writeSoul = async (
    id: string,
    content: string,
    expectedRevision?: string
  ): Promise<string> =>
    resultOrThrow(
      await call('write_ai_profile_soul', { id, content, expectedRevision })
    )

  const projectsModel = createAiProjectsModel({
    listProjects: async () => resultOrThrow(await call('list_ai_projects')),
    createProject: async (project) => {
      resultOrThrow(await call('create_ai_project', { project }))
    },
    saveProject: async (project, expectedRevision) =>
      resultOrThrow(
        await call('save_ai_project', { project, expectedRevision })
      ),
    deleteProject: async (id) => {
      resultOrThrow(await call('delete_ai_project', { id }))
    },
    pickExternalFolder: async () => resultOrThrow(await call('pick_directory')),
  })

  /** The main vault and the attached ones of this device */
  const vaults = ref<VaultInfo[]>([])
  /** The attached vaults that are there now */
  const connectedVaultIds = computed(() =>
    vaults.value
      .filter((vault) => !vault.isMain && vault.status === 'connected')
      .map((vault) => vault.vaultId)
  )
  const loadVaults = async () => {
    vaults.value = resultOrThrow(await call('list_ai_vaults'))
  }

  const vaultPath = ref('')
  /** Why the vault cannot be read, e.g. its configured folder is unavailable */
  const vaultError = ref('')
  const isLoaded = ref(false)

  let loadRequest = 0
  /** Reads the vault anew; a load started later wins */
  const loadAll = async (): Promise<void> => {
    const request = ++loadRequest
    let active = true
    const isCurrent = () => active && request === loadRequest
    try {
      const path = resultOrThrow(await call('get_ai_vault_path'))
      if (!isCurrent()) return
      await Promise.all([
        profilesModel.loadProfiles(isCurrent),
        projectsModel.loadProjects(isCurrent),
        loadVaults().catch((error) =>
          clientLogger.error('Could not list AI vaults', error, 'ai-profiles')
        ),
      ])
      if (request !== loadRequest) return
      vaultPath.value = path
      vaultError.value = ''
    } catch (error) {
      if (request !== loadRequest) return
      profilesModel.profiles.value = []
      projectsModel.projects.value = []
      vaultError.value = describeError(error, translate)
    } finally {
      active = false
      if (request === loadRequest) isLoaded.value = true
    }
  }

  let disposed = false
  let stopStorageListening: (() => void) | undefined
  if (desktopClient.isAvailable()) {
    void desktopClient
      .listen(DESKTOP_EVENTS.STORAGE_CHANGED, ({ vaultChanges }) => {
        if (vaultChanges.length) void loadAll()
      })
      .then((stop) => {
        if (disposed) stop()
        else stopStorageListening = stop
      })
      .catch((error) =>
        clientLogger.error(
          'Could not follow vault changes',
          error,
          'ai-profiles'
        )
      )
  }
  // vaults attached or removed, here or in another window
  watch(
    () => JSON.stringify(desktopStore.userConfig?.aiVaults?.attached ?? []),
    (attached, previous) => {
      if (attached !== previous) void loadAll()
    }
  )
  onScopeDispose(() => {
    disposed = true
    stopStorageListening?.()
    loadRequest += 1
  })

  const openVaultDir = async (
    profileId?: string,
    vaultId?: string
  ): Promise<void> => {
    resultOrThrow(await call('open_ai_vault_location', { profileId, vaultId }))
  }

  /** What a folder holds as a vault to attach */
  const inspectVaultFolder = async (path: string): Promise<VaultFolder> =>
    resultOrThrow(await call('inspect_ai_vault_folder', { path }))

  /** Changes the vaults of this device, then reads everything anew */
  const changeVaults = async (change: () => Promise<unknown>) => {
    await change()
    await loadAll()
  }
  const attachVault = (path: string, name: string) =>
    changeVaults(async () =>
      resultOrThrow(await call('attach_ai_vault', { path, name }))
    )
  const relinkVault = (vaultId: string, path: string) =>
    changeVaults(async () =>
      resultOrThrow(await call('relink_ai_vault', { vaultId, path }))
    )
  const detachVault = (vaultId: string) =>
    changeVaults(async () =>
      resultOrThrow(await call('detach_ai_vault', { vaultId }))
    )
  const renameVault = (vaultId: string, name: string) =>
    changeVaults(async () =>
      resultOrThrow(await call('rename_ai_vault', { vaultId, name }))
    )

  /** How many chats removing the profile `id` removes with it */
  const countChats = async (id: string): Promise<number> =>
    (await createIpcChatSessionStorageDriver(ipcStore, id).listChats()).length

  /** The chats of all profiles, which share one history setting */
  const profileChats = createProfileChatsModel({
    listProfileIds: () => profilesModel.profiles.value.map(({ id }) => id),
    storageFor: (id) => createIpcChatSessionStorageDriver(ipcStore, id),
  })

  /** Removing a project removes the profiles' permissions for it as well */
  const deleteProject = async (id: string): Promise<void> => {
    await projectsModel.deleteProject(id)
    await profilesModel.loadProfiles()
  }

  const listMemoryTopics = async (profileId: string) =>
    resultOrThrow(await call('list_ai_profile_memory_topics', { profileId }))

  const readMemory = async (profileId: string, file: string) =>
    resultOrThrow(await call('read_ai_profile_memory', { profileId, file }))

  const writeMemory = async (
    profileId: string,
    file: string,
    content: string,
    chatId?: string | null
  ) =>
    resultOrThrow(
      await call('rewrite_ai_profile_memory', {
        profileId,
        file,
        content,
        chatId,
      })
    )

  const clearMemory = async (profileId: string) => {
    resultOrThrow(await call('clear_ai_profile_memory', { profileId }))
  }

  const undoMemory = async (
    profileId: string,
    file: string,
    chatId?: string | null
  ) =>
    resultOrThrow(
      await call('undo_ai_profile_memory', { profileId, file, chatId })
    )

  return {
    profiles: readonly(profilesModel.profiles),
    projects: readonly(projectsModel.projects),
    vaultPath: readonly(vaultPath),
    vaultError: readonly(vaultError),
    /** Gives an external project its folder on this device */
    setProjectFolder: async (id: string): Promise<boolean> => {
      const project = projectsModel.getProject(id)
      const folder = await projectsModel.pickExternalFolder()
      if (!project || !folder) return false
      await projectsModel.saveProject({ ...project, targetPath: folder })
      return true
    },
    isLoaded: readonly(isLoaded),
    loadAll,
    openVaultDir,
    vaults: readonly(vaults),
    connectedVaultIds,
    inspectVaultFolder,
    attachVault,
    relinkVault,
    detachVault,
    renameVault,
    pickFolder: projectsModel.pickExternalFolder,
    // Profiles
    getProfile: profilesModel.getProfile,
    createProfile: profilesModel.createProfile,
    updateProfile: profilesModel.updateProfile,
    refreshProfile: profilesModel.refreshProfile,
    duplicateProfile: profilesModel.duplicateProfile,
    deleteProfile: profilesModel.deleteProfile,
    countChats,
    countAllProfileChats: profileChats.countAll,
    clearAllProfileChats: profileChats.clearAll,
    setProjectAccess: profilesModel.setProjectAccess,
    readSoul: profilesModel.readSoul,
    readSoulWithRevision,
    writeSoul,
    profileConflicts: readonly(profilesModel.conflicts),
    resolveProfileConflict: profilesModel.resolveConflict,
    // Memory
    listMemoryTopics,
    readMemory,
    writeMemory,
    clearMemory,
    undoMemory,
    // Projects
    getProject: projectsModel.getProject,
    createProject: projectsModel.createProject,
    saveProject: projectsModel.saveProject,
    projectConflicts: readonly(projectsModel.conflicts),
    resolveProjectConflict: projectsModel.resolveConflict,
    deleteProject,
  }
})
