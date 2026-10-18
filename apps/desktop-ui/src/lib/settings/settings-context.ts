import type { InjectionKey, Ref } from 'vue'
import type { UserConfig } from '@tyco/shared'

import type { SettingsOperations } from './settings-operations'

/**
 * What the settings page hands its tabs. A tab edits the draft in place, the
 * settings session saves it; tabs emit nothing
 */
export interface SettingsContext {
  draft: Ref<UserConfig>
  operations: SettingsOperations
  /** The UI language the draft resolves to */
  effectiveAppLanguage: Readonly<Ref<string>>
  /** Opens another settings tab */
  navigate: (tab: string) => void
  /** Opens the commands tab on one command */
  editCommand: (commandId: string) => void
}

export const SETTINGS_CONTEXT_KEY: InjectionKey<SettingsContext> =
  Symbol('settings-context')
