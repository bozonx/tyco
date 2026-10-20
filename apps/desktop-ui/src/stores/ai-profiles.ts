import { errorMessage } from '@tyco/shared/value-guards'
import { clientLogger } from '../lib/logger'
import { defineStore } from 'pinia'
import { readonly, ref, watch } from 'vue'
import type { IpcResult } from '@tyco/shared'

import { createAiProfilesModel } from '../lib/ai-profiles/ai-profiles-model'
import { createAiProjectsModel } from '../lib/ai-profiles/ai-projects-model'
import { createIpcChatSessionStorageDriver } from '../lib/chat/chat-session-storage'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'

function resultOf<T>(response: IpcResult<T>): T {
  if (!response.success) throw new Error(response.error)
  return response.result as T
}

export const useAiProfilesStore = defineStore('ai-profiles', () => {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const call = ipcStore.call

  const profilesModel = createAiProfilesModel({
    reportError: (error) =>
      clientLogger.error('Could not save AI profile', error, 'ai-profiles'),
    listProfiles: async () => resultOf(await call('list_ai_profiles')),
    getProfile: async (id) => resultOf(await call('get_ai_profile', { id })),
    createProfile: async (profile, soul) => {
      resultOf(await call('create_ai_profile', { profile, soul }))
    },
    saveProfile: async (profile) => {
      resultOf(await call('save_ai_profile', { profile }))
    },
    deleteProfile: async (id) => {
      resultOf(await call('delete_ai_profile', { id }))
    },
    readSoul: async (id) =>
      resultOf(await call('read_ai_profile_soul', { id })),
    writeSoul: async (id, content) => {
      resultOf(await call('write_ai_profile_soul', { id, content }))
    },
  })

  const projectsModel = createAiProjectsModel({
    listProjects: async () => resultOf(await call('list_ai_projects')),
    createProject: async (project) => {
      resultOf(await call('create_ai_project', { project }))
    },
    saveProject: async (project) => {
      resultOf(await call('save_ai_project', { project }))
    },
    deleteProject: async (id) => {
      resultOf(await call('delete_ai_project', { id }))
    },
    pickExternalFolder: async () => resultOf(await call('pick_directory')),
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
      const path = resultOf(await call('get_ai_vault_path'))
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
      vaultError.value = errorMessage(error)
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
    resultOf(await call('open_ai_vault_location', { profileId }))
  }

  /** How many chats removing the profile `id` removes with it */
  const countChats = async (id: string): Promise<number> =>
    (await createIpcChatSessionStorageDriver(ipcStore, id).listChats()).length

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
    deleteProfile: profilesModel.deleteProfile,
    countChats,
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
