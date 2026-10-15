import { defineStore } from 'pinia'
import { computed } from 'vue'
import { createAiProfilesModel } from '../lib/ai-profiles/ai-profiles-model'
import { createAiProjectsModel } from '../lib/ai-profiles/ai-projects-model'
import {
  createIpcChatSessionStorageDriver,
  createProfileIpcChatSessionStorageDriver,
  type ChatSessionStorageDriver,
} from '../lib/chat/chat-session-storage'
import { appNavigation } from '../lib/navigation/navigation'
import { useIpcStore } from './ipc'

export const useAiProfilesStore = defineStore('ai-profiles', () => {
  const ipcStore = useIpcStore()

  const profilesModel = createAiProfilesModel({
    listProfiles: async () => {
      const res = await ipcStore.callFunction('listAiProfiles')
      return res.success && Array.isArray(res.result) ? res.result : []
    },
    saveProfile: async (profile) => {
      const res = await ipcStore.callFunction('saveAiProfile', [profile])
      if (!res.success) throw new Error(res.error)
    },
    deleteProfile: async (id) => {
      const res = await ipcStore.callFunction('deleteAiProfile', [id])
      if (!res.success) throw new Error(res.error)
    },
    readSoul: async (id) => {
      const res = await ipcStore.callFunction('readProfileSoul', [id])
      return res.success ? res.result : ''
    },
    writeSoul: async (id, content) => {
      const res = await ipcStore.callFunction('writeProfileSoul', [id, content])
      if (!res.success) throw new Error(res.error)
    },
  })

  const projectsModel = createAiProjectsModel({
    listProjects: async () => {
      const res = await ipcStore.callFunction('listAiProjects')
      return res.success && Array.isArray(res.result) ? res.result : []
    },
    saveProject: async (project) => {
      const res = await ipcStore.callFunction('saveAiProject', [project])
      if (!res.success) throw new Error(res.error)
    },
    deleteProject: async (id) => {
      const res = await ipcStore.callFunction('deleteAiProject', [id])
      if (!res.success) throw new Error(res.error)
    },
    pickExternalFolder: async () => {
      const res = await ipcStore.callFunction('pickExternalProjectFolder')
      return res.success ? res.result : null
    },
  })

  const activeProfileId = computed(
    () => appNavigation.currentProfileId?.() || null
  )

  const activeProfile = computed(() => {
    if (!activeProfileId.value) return null
    return profilesModel.getProfile(activeProfileId.value) || null
  })

  const loadAll = async () => {
    await Promise.all([
      profilesModel.loadProfiles(),
      projectsModel.loadProjects(),
    ])
  }

  const getVaultPath = async (): Promise<string> => {
    const res = await ipcStore.callFunction('getAiVaultPath')
    return res.success ? res.result : ''
  }

  const openFolder = async (path: string): Promise<void> => {
    const res = await ipcStore.callFunction('openFolderInOs', [path])
    if (!res.success) throw new Error(res.error)
  }

  const getStorageDriver = (
    profileId?: string | null
  ): ChatSessionStorageDriver => {
    if (profileId) {
      return createProfileIpcChatSessionStorageDriver(ipcStore, profileId)
    }
    return createIpcChatSessionStorageDriver(ipcStore)
  }

  return {
    profiles: profilesModel.profiles,
    projects: projectsModel.projects,
    activeProfileId,
    activeProfile,
    loadAll,
    getVaultPath,
    openFolder,
    getStorageDriver,
    // Profiles
    getProfile: profilesModel.getProfile,
    createProfile: profilesModel.createProfile,
    saveProfile: profilesModel.saveProfile,
    deleteProfile: profilesModel.deleteProfile,
    updateLastModel: profilesModel.updateLastModel,
    setProjectPermission: profilesModel.setProjectPermission,
    readSoul: profilesModel.readSoul,
    writeSoul: profilesModel.writeSoul,
    // Projects
    getProject: projectsModel.getProject,
    createProject: projectsModel.createProject,
    saveProject: projectsModel.saveProject,
    deleteProject: projectsModel.deleteProject,
    pickExternalFolder: projectsModel.pickExternalFolder,
  }
})
