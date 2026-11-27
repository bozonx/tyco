import {
  DESKTOP_EVENTS,
  type ProjectTransferPreview,
  type WorkspaceChatHistory,
  type WorkspaceFolder,
  type WorkspaceInfo,
} from '@tyco/shared'

import { clientLogger } from '../lib/logger'
import { joinRef, workspaceOfRef } from '../lib/ai-profiles/profile-ref'
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
    createProfile: async (profile, soul) =>
      resultOrThrow(await call('create_ai_profile', { profile, soul })),
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
    createProject: async (project) =>
      resultOrThrow(await call('create_ai_project', { project })),
    saveProject: async (project, expectedRevision) =>
      resultOrThrow(
        await call('save_ai_project', { project, expectedRevision })
      ),
    convertProject: async (id, options, expectedRevision) =>
      resultOrThrow(
        await call('convert_ai_project', {
          id,
          targetPath: options.targetPath,
          transferFiles: options.transferFiles,
          trashSource: options.trashSource,
          expectedRevision,
        })
      ),
    deleteProject: async (id) => {
      resultOrThrow(await call('delete_ai_project', { id }))
    },
    pickExternalFolder: async () => resultOrThrow(await call('pick_directory')),
  })

  /** The main workspace and the attached ones of this device */
  const workspaces = ref<WorkspaceInfo[]>([])
  /** The attached workspaces that are there now */
  const connectedWorkspaceIds = computed(() =>
    workspaces.value
      .filter(
        (workspace) => !workspace.isMain && workspace.status === 'connected'
      )
      .map((workspace) => workspace.workspaceId)
  )
  const loadWorkspaces = async () => {
    workspaces.value = resultOrThrow(await call('list_ai_workspaces'))
  }

  /** Why the workspace cannot be read, e.g. its configured folder is unavailable */
  const workspaceError = ref('')
  const isLoaded = ref(false)

  let loadRequest = 0
  /** Reads the workspace anew; a load started later wins */
  const loadAll = async (): Promise<void> => {
    const request = ++loadRequest
    let active = true
    const isCurrent = () => active && request === loadRequest
    try {
      await Promise.all([
        profilesModel.loadProfiles(isCurrent),
        projectsModel.loadProjects(isCurrent),
        loadWorkspaces().catch((error) =>
          clientLogger.error(
            'Could not list AI workspaces',
            error,
            'ai-profiles'
          )
        ),
      ])
      if (request !== loadRequest) return
      workspaceError.value = ''
    } catch (error) {
      if (request !== loadRequest) return
      profilesModel.profiles.value = []
      projectsModel.projects.value = []
      workspaceError.value = describeError(error, translate)
    } finally {
      active = false
      if (request === loadRequest) isLoaded.value = true
    }
  }

  const profileStorageRevisions = ref<Record<string, number>>({})
  let disposed = false
  let stopStorageListening: (() => void) | undefined
  if (desktopClient.isAvailable()) {
    void desktopClient
      .listen(DESKTOP_EVENTS.STORAGE_CHANGED, ({ workspaceChanges }) => {
        for (const change of workspaceChanges) {
          const match = /^profiles\/([^/]+)\/(profile\.json|SOUL\.md)$/.exec(
            change.path
          )
          if (match) {
            const key = joinRef(change.workspaceId, match[1]!)
            profileStorageRevisions.value[key] =
              (profileStorageRevisions.value[key] ?? 0) + 1
          }
        }
        if (workspaceChanges.length) void loadAll()
      })
      .then((stop) => {
        if (disposed) stop()
        else stopStorageListening = stop
      })
      .catch((error) =>
        clientLogger.error(
          'Could not follow workspace changes',
          error,
          'ai-profiles'
        )
      )
  }
  // workspaces attached or removed, here or in another window
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

  const openWorkspaceDir = async (
    profileId?: string,
    workspaceId?: string
  ): Promise<void> => {
    resultOrThrow(
      await call('open_ai_workspace_location', { profileId, workspaceId })
    )
  }

  /** Shows the folder of a project on this device in the file manager */
  const openProjectFolder = async (projectId: string): Promise<void> => {
    resultOrThrow(await call('open_ai_project_location', { id: projectId }))
  }

  /**
   * What converting a project would transfer; `targetPath` is the folder an
   * internal project would get
   */
  const inspectProjectTransfer = async (
    projectId: string,
    targetPath?: string
  ): Promise<ProjectTransferPreview> =>
    resultOrThrow(
      await call('inspect_ai_project_transfer', { id: projectId, targetPath })
    )

  /** What a folder holds as a workspace to attach */
  const inspectWorkspaceFolder = async (
    path: string
  ): Promise<WorkspaceFolder> =>
    resultOrThrow(await call('inspect_ai_workspace_folder', { path }))

  /** Changes the workspaces of this device, then reads everything anew */
  const changeWorkspaces = async (change: () => Promise<unknown>) => {
    await change()
    await loadAll()
  }
  const attachWorkspace = (path: string, name: string) =>
    changeWorkspaces(async () =>
      resultOrThrow(await call('attach_ai_workspace', { path, name }))
    )
  const relinkWorkspace = (workspaceId: string, path: string) =>
    changeWorkspaces(async () =>
      resultOrThrow(await call('relink_ai_workspace', { workspaceId, path }))
    )
  const detachWorkspace = (workspaceId: string) =>
    changeWorkspaces(async () =>
      resultOrThrow(await call('detach_ai_workspace', { workspaceId }))
    )
  const renameWorkspace = (workspaceId: string, name: string) =>
    changeWorkspaces(async () =>
      resultOrThrow(await call('rename_ai_workspace', { workspaceId, name }))
    )

  /** The chat history settings of the workspace of a profile reference */
  const workspaceChatHistoryOf = (
    profileId: string | null | undefined
  ): WorkspaceChatHistory | undefined =>
    profileId
      ? workspaces.value.find(
          (workspace) => workspace.workspaceId === workspaceOfRef(profileId)
        )?.chatHistory
      : undefined

  /** Stores how the chats of a workspace's profiles are kept, on every device */
  const setWorkspaceChatHistory = async (
    workspaceId: string,
    chatHistory: WorkspaceChatHistory
  ) => {
    resultOrThrow(
      await call('set_ai_workspace_chat_history', { workspaceId, chatHistory })
    )
    await loadWorkspaces()
  }

  /**
   * Moves a profile to another workspace; the backend points the settings that
   * name it to where it landed. Returns its new reference
   */
  const moveProfile = async (
    id: string,
    workspaceId: string
  ): Promise<string> => {
    const moved = resultOrThrow(
      await call('move_ai_profile', { id, workspaceId })
    )
    await loadAll()
    return moved.id
  }

  /** Moves a project to another workspace. Returns its new reference */
  const moveProject = async (
    id: string,
    workspaceId: string
  ): Promise<string> => {
    const moved = resultOrThrow(
      await call('move_ai_project', { id, workspaceId })
    )
    await loadAll()
    return moved.id
  }

  /** How many chats removing the profile `id` removes with it */
  const countChats = async (id: string): Promise<number> =>
    (await createIpcChatSessionStorageDriver(ipcStore, id).listChats()).length

  /** The chats of the profiles of all workspaces, or of one */
  const profileChats = createProfileChatsModel({
    listProfileIds: () => profilesModel.profiles.value.map(({ id }) => id),
    storageFor: (id) => createIpcChatSessionStorageDriver(ipcStore, id),
  })

  const profileIdsOf = (workspaceId: string) =>
    profilesModel.profiles.value
      .map(({ id }) => id)
      .filter((id) => workspaceOfRef(id) === workspaceId)

  /** Removing a project removes the profiles' permissions for it as well */
  const deleteProject = async (id: string): Promise<void> => {
    await projectsModel.deleteProject(id)
    await profilesModel.loadProfiles()
  }

  const listMemoryTopics = async (profileId: string) =>
    resultOrThrow(await call('list_ai_profile_memory_topics', { profileId }))

  /** Reads a memory file for the user, not as a read of the model */
  const readMemory = async (profileId: string, file: string) =>
    resultOrThrow(await call('peek_ai_profile_memory', { profileId, file }))

  /**
   * Stores a memory file the user edited; with `expectedContent` only over the
   * file as it was opened, failing with `staleRevision` otherwise
   */
  const writeMemory = async (
    profileId: string,
    file: string,
    content: string,
    expectedContent?: string
  ) => {
    resultOrThrow(
      await call('save_ai_profile_memory', {
        profileId,
        file,
        content,
        expectedContent,
      })
    )
  }

  /** Deletes one memory file; `core.md` is reset instead */
  const deleteMemoryFile = async (profileId: string, file: string) => {
    resultOrThrow(
      await call('delete_ai_profile_memory_file', { profileId, file })
    )
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
    workspaceError: readonly(workspaceError),
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
    openWorkspaceDir,
    openProjectFolder,
    inspectProjectTransfer,
    workspaces: readonly(workspaces),
    connectedWorkspaceIds,
    inspectWorkspaceFolder,
    attachWorkspace,
    relinkWorkspace,
    detachWorkspace,
    renameWorkspace,
    setWorkspaceChatHistory,
    workspaceChatHistoryOf,
    moveProfile,
    moveProject,
    pickFolder: projectsModel.pickExternalFolder,
    // Profiles
    getProfile: profilesModel.getProfile,
    createProfile: profilesModel.createProfile,
    updateProfile: profilesModel.updateProfile,
    refreshProfile: profilesModel.refreshProfile,
    duplicateProfile: profilesModel.duplicateProfile,
    deleteProfile: profilesModel.deleteProfile,
    countChats,
    countAllProfileChats: () => profileChats.countAll(),
    clearAllProfileChats: () => profileChats.clearAll(),
    countWorkspaceChats: (workspaceId: string) =>
      profileChats.countAll(profileIdsOf(workspaceId)),
    clearWorkspaceChats: (workspaceId: string) =>
      profileChats.clearAll(profileIdsOf(workspaceId)),
    setProjectAccess: profilesModel.setProjectAccess,
    readSoul: profilesModel.readSoul,
    readSoulWithRevision,
    writeSoul,
    profileStorageRevisions: readonly(profileStorageRevisions),
    profileConflicts: readonly(profilesModel.conflicts),
    resolveProfileConflict: profilesModel.resolveConflict,
    // Memory
    listMemoryTopics,
    readMemory,
    writeMemory,
    deleteMemoryFile,
    undoMemory,
    // Projects
    getProject: projectsModel.getProject,
    createProject: projectsModel.createProject,
    saveProject: projectsModel.saveProject,
    convertProject: projectsModel.convertProject,
    projectConflicts: readonly(projectsModel.conflicts),
    resolveProjectConflict: projectsModel.resolveConflict,
    deleteProject,
  }
})
