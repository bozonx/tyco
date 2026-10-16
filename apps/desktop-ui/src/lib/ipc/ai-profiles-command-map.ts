import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { AiProfilesFunctions } from './functions/ai-profiles'
import type { DomainCommandMap } from './command-types'

export function createAiProfilesCommandMap(): DomainCommandMap<
  keyof AiProfilesFunctions
> {
  return {
    getAiVaultPath: { command: DESKTOP_COMMANDS.GET_AI_VAULT_PATH },
    openAiVaultDir: {
      command: DESKTOP_COMMANDS.OPEN_AI_VAULT_DIR,
      buildArgs: ([profileId]) =>
        ({ profileId }) satisfies DesktopCommandArgs<'open_ai_vault_dir'>,
    },
    listAiProfiles: { command: DESKTOP_COMMANDS.LIST_AI_PROFILES },
    getAiProfile: {
      command: DESKTOP_COMMANDS.GET_AI_PROFILE,
      buildArgs: ([id]) =>
        ({ id }) satisfies DesktopCommandArgs<'get_ai_profile'>,
    },
    createAiProfile: {
      command: DESKTOP_COMMANDS.CREATE_AI_PROFILE,
      buildArgs: ([profile, soul]) =>
        ({ profile, soul }) satisfies DesktopCommandArgs<'create_ai_profile'>,
    },
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
    createAiProject: {
      command: DESKTOP_COMMANDS.CREATE_AI_PROJECT,
      buildArgs: ([project]) =>
        ({ project }) satisfies DesktopCommandArgs<'create_ai_project'>,
    },
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
  }
}
