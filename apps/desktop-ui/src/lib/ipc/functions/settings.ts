import type { SessionState, UserConfig } from '@tyco/shared'

export interface SettingsFunctions {
  saveUserConfig: { args: [userConfig: UserConfig, baseConfig: UserConfig] }
  patchSessionState: { args: [patch: Partial<SessionState>] }
}
