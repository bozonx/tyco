import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { IpcResult } from '@tyco/shared'

import { createAiProfilesModel } from '../lib/ai-profiles/ai-profiles-model'
import { createAiProjectsModel } from '../lib/ai-profiles/ai-projects-model'
import { useIpcStore } from './ipc'

function resultOf<T>(response: IpcResult<T>): T {
  if (!response.success) throw new Error(response.error)
  return response.result as T
}

export const useAiProfilesStore = defineStore('ai-profiles', () => {
  const ipcStore = useIpcStore()
  const call = ipcStore.callFunction

  const profilesModel = createAiProfilesModel({
    listProfiles: async () => resultOf(await call('listAiProfiles')),
    getProfile: async (id) => resultOf(await call('getAiProfile', [id])),
    createProfile: async (profile, soul) => {
      resultOf(await call('createAiProfile', [profile, soul]))
    },
    saveProfile: async (profile) => {
      resultOf(await call('saveAiProfile', [profile]))
    },
    deleteProfile: async (id) => {
      resultOf(await call('deleteAiProfile', [id]))
    },
    readSoul: async (id) => resultOf(await call('readProfileSoul', [id])),
    writeSoul: async (id, content) => {
      resultOf(await call('writeProfileSoul', [id, content]))
    },
  })

  const projectsModel = createAiProjectsModel({
    listProjects: async () => resultOf(await call('listAiProjects')),
    createProject: async (project) => {
      resultOf(await call('createAiProject', [project]))
    },
    saveProject: async (project) => {
      resultOf(await call('saveAiProject', [project]))
    },
    deleteProject: async (id) => {
      resultOf(await call('deleteAiProject', [id]))
    },
    pickExternalFolder: async () => resultOf(await call('pickDirectory')),
  })

  const vaultPath = ref('')
  /** Why the vault cannot be read, e.g. its configured folder is unavailable */
  const vaultError = ref('')
  const isLoaded = ref(false)

  let loadRequest = 0
  /** Reads the vault anew; a load started later wins */
  const loadAll = async (): Promise<void> => {
    const request = ++loadRequest
    try {
      const path = resultOf(await call('getAiVaultPath'))
      await Promise.all([
        profilesModel.loadProfiles(),
        projectsModel.loadProjects(),
      ])
      if (request !== loadRequest) return
      vaultPath.value = path
      vaultError.value = ''
    } catch (error) {
      if (request !== loadRequest) return
      profilesModel.profiles.value = []
      projectsModel.projects.value = []
      vaultError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (request === loadRequest) isLoaded.value = true
    }
  }

  // the vault moves once the settings with its new path are stored
  watch(
    () => ipcStore.desktopState.userConfig?.aiProfiles?.vaultPath,
    (path, previous) => {
      if (path !== previous) void loadAll()
    }
  )

  const openVaultDir = async (profileId?: string): Promise<void> => {
    resultOf(await call('openAiVaultDir', profileId ? [profileId] : []))
  }

  /** Removing a project removes the profiles' permissions for it as well */
  const deleteProject = async (id: string): Promise<void> => {
    await projectsModel.deleteProject(id)
    await profilesModel.loadProfiles()
  }

  return {
    profiles: profilesModel.profiles,
    projects: projectsModel.projects,
    vaultPath,
    vaultError,
    isLoaded,
    loadAll,
    openVaultDir,
    pickFolder: projectsModel.pickExternalFolder,
    // Profiles
    getProfile: profilesModel.getProfile,
    createProfile: profilesModel.createProfile,
    updateProfile: profilesModel.updateProfile,
    refreshProfile: profilesModel.refreshProfile,
    deleteProfile: profilesModel.deleteProfile,
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
