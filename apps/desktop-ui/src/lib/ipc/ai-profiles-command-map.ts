import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { AiProfilesFunctions } from './functions/ai-profiles'
import type { DomainCommandMap } from './command-types'

export function createAiProfilesCommandMap(): DomainCommandMap<
  keyof AiProfilesFunctions
> {
  return {
    listAiProfiles: { command: DESKTOP_COMMANDS.LIST_AI_PROFILES },
    saveAiProfile: {
      command: DESKTOP_COMMANDS.SAVE_AI_PROFILE,
      buildArgs: ([profile]) =>
        ({ profile }) satisfies DesktopCommandArgs<'save_ai_profile'>,
    },
    deleteAiProfile: {
      command: DESKTOP_COMMANDS.DELETE_AI_PROFILE,
      buildArgs: ([id]) =>
        ({ id }) satisfies DesktopCommandArgs<'delete_ai_profile'>,
    },
    readProfileSoul: {
      command: DESKTOP_COMMANDS.READ_PROFILE_SOUL,
      buildArgs: ([id]) =>
        ({ id }) satisfies DesktopCommandArgs<'read_profile_soul'>,
    },
    writeProfileSoul: {
      command: DESKTOP_COMMANDS.WRITE_PROFILE_SOUL,
      buildArgs: ([id, content]) =>
        ({ id, content }) satisfies DesktopCommandArgs<'write_profile_soul'>,
    },
    listAiProjects: { command: DESKTOP_COMMANDS.LIST_AI_PROJECTS },
    saveAiProject: {
      command: DESKTOP_COMMANDS.SAVE_AI_PROJECT,
      buildArgs: ([project]) =>
        ({ project }) satisfies DesktopCommandArgs<'save_ai_project'>,
    },
    deleteAiProject: {
      command: DESKTOP_COMMANDS.DELETE_AI_PROJECT,
      buildArgs: ([id]) =>
        ({ id }) satisfies DesktopCommandArgs<'delete_ai_project'>,
    },
    pickExternalProjectFolder: {
      command: DESKTOP_COMMANDS.PICK_EXTERNAL_PROJECT_FOLDER,
    },
    listProfileChats: {
      command: DESKTOP_COMMANDS.LIST_PROFILE_CHATS,
      buildArgs: ([profileId]) =>
        ({ profileId }) satisfies DesktopCommandArgs<'list_profile_chats'>,
    },
    getProfileChat: {
      command: DESKTOP_COMMANDS.GET_PROFILE_CHAT,
      buildArgs: ([profileId, id]) =>
        ({ profileId, id }) satisfies DesktopCommandArgs<'get_profile_chat'>,
    },
    saveProfileChat: {
      command: DESKTOP_COMMANDS.SAVE_PROFILE_CHAT,
      buildArgs: ([profileId, chat]) =>
        ({ profileId, chat }) satisfies DesktopCommandArgs<'save_profile_chat'>,
    },
    renameProfileChat: {
      command: DESKTOP_COMMANDS.RENAME_PROFILE_CHAT,
      buildArgs: ([profileId, id, title]) =>
        ({
          profileId,
          id,
          title,
        }) satisfies DesktopCommandArgs<'rename_profile_chat'>,
    },
    deleteProfileChat: {
      command: DESKTOP_COMMANDS.DELETE_PROFILE_CHAT,
      buildArgs: ([profileId, id]) =>
        ({ profileId, id }) satisfies DesktopCommandArgs<'delete_profile_chat'>,
    },
    clearProfileChats: {
      command: DESKTOP_COMMANDS.CLEAR_PROFILE_CHATS,
      buildArgs: ([profileId]) =>
        ({ profileId }) satisfies DesktopCommandArgs<'clear_profile_chats'>,
    },
  }
}
