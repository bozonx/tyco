import type { LocalState, UserConfig } from '@tyco/shared'

export interface SettingsFunctions {
  saveUserConfig: { args: [userConfig: UserConfig, baseConfig: UserConfig] }
  patchLocalState: { args: [patch: Partial<LocalState>] }
  getUserConfig: { args: [] }
}
