import { inject } from 'vue'

import { SETTINGS_CONTEXT_KEY } from '../lib/settings/settings-context'

/** The settings page state for one of its tabs */
export function useSettingsContext() {
  const context = inject(SETTINGS_CONTEXT_KEY)
  if (!context) throw new Error('Settings tabs render inside the settings page')
  return context
}
