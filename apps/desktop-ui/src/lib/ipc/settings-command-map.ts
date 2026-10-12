import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { SettingsFunctions } from './functions/settings'
import type { DomainCommandMap } from './command-types'

export function createSettingsCommandMap(): DomainCommandMap<
  keyof SettingsFunctions
> {
  return {
    saveUserConfig: {
      command: DESKTOP_COMMANDS.SAVE_USER_CONFIG,
      buildArgs: ([userConfig, baseConfig]) =>
        ({
          userConfig,
          baseConfig,
        }) satisfies DesktopCommandArgs<'save_user_config'>,
    },
    patchLocalState: {
      command: DESKTOP_COMMANDS.PATCH_LOCAL_STATE,
      buildArgs: ([patch]) =>
        ({ patch }) satisfies DesktopCommandArgs<'patch_local_state'>,
    },
    getUserConfig: { command: DESKTOP_COMMANDS.GET_USER_CONFIG },
  }
}
