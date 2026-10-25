import { clientLogger } from '../lib/logger'
import { defineStore } from 'pinia'
import { readonly, ref, watch } from 'vue'

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
  const desktopStore = useDesktopStore()
  const call = ipcStore.call

  const profilesModel = createAiProfilesModel({
    reportError: (error) =>
      clientLogger.error('Could not save AI profile', error, 'ai-profiles'),
    listProfiles: async () => resultOrThrow(await call('list_ai_profiles')),
    getProfile: async (id) =>
      resultOrThrow(await call('get_ai_profile', { id })),
    createProfile: async (profile, soul) => {
      resultOrThrow(await call('create_ai_profile', { profile, soul }))
    },
    saveProfile: async (profile) => {
      resultOrThrow(await call('save_ai_profile', { profile }))
    },
    deleteProfile: async (id) => {
      resultOrThrow(await call('delete_ai_profile', { id }))
    },
    readSoul: async (id) =>
      resultOrThrow(await call('read_ai_profile_soul', { id })),
    writeSoul: async (id, content) => {
      resultOrThrow(await call('write_ai_profile_soul', { id, content }))
    },
  })

  const projectsModel = createAiProjectsModel({
    listProjects: async () => resultOrThrow(await call('list_ai_projects')),
    createProject: async (project) => {
      resultOrThrow(await call('create_ai_project', { project }))
    },
    saveProject: async (project) => {
      resultOrThrow(await call('save_ai_project', { project }))
    },
    deleteProject: async (id) => {
      resultOrThrow(await call('delete_ai_project', { id }))
    },
    pickExternalFolder: async () => resultOrThrow(await call('pick_directory')),
  })

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

  // the vault moves once the settings with its new path are stored
  watch(
    () => desktopStore.userConfig?.aiVault?.path,
    (path, previous) => {
      if (path !== previous) void loadAll()
    }
  )

  const openVaultDir = async (profileId?: string): Promise<void> => {
    resultOrThrow(await call('open_ai_vault_location', { profileId }))
  }

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

  return {
    profiles: readonly(profilesModel.profiles),
    projects: readonly(projectsModel.projects),
    vaultPath: readonly(vaultPath),
    vaultError: readonly(vaultError),
    isLoaded: readonly(isLoaded),
    loadAll,
    openVaultDir,
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
    setProjectPermission: profilesModel.setProjectPermission,
    readSoul: profilesModel.readSoul,
    writeSoul: profilesModel.writeSoul,
    // Projects
    getProject: projectsModel.getProject,
    createProject: projectsModel.createProject,
    saveProject: projectsModel.saveProject,
    deleteProject,
  }
})
