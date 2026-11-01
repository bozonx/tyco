import { inject } from 'vue'
import type { VariableValues } from '@tyco/shared'

import { SETTINGS_CONTEXT_KEY } from '../lib/settings/settings-context'

/**
 * The values the variables have on this device as the settings are being
 * edited: those of the draft, which may not be saved yet
 */
export function useSettingsVariables(): () => VariableValues {
  const context = inject(SETTINGS_CONTEXT_KEY, null)
  return () => context?.variables?.() ?? {}
}
