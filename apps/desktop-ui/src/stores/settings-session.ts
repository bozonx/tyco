import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'
import { CONFIG_VERSION } from '@tyco/shared'

import useToast from '../composables/use-toast'
import { translate } from '../lib/i18n'
import { createSettingsConfig } from '../lib/settings/settings-config'
import { createSettingsSession } from '../lib/settings/settings-session'
import { usePluginRuntimeStore } from './plugin-runtime'
import { useDesktopStore } from './desktop'
import { useThemeStore } from './theme'

/** Owns the draft across settings navigation, including failed final saves. */
export const useSettingsSessionStore = defineStore('settingsSession', () => {
  const desktop = useDesktopStore()
  const { pluginFactories } = usePluginRuntimeStore()
  const theme = useThemeStore()
  const { toastText } = useToast()
  const config = createSettingsConfig({
    pluginFactories: () => pluginFactories,
    appearance: () => theme.settings,
  })
  const session = createSettingsSession({
    initialConfig: desktop.userConfig,
    prepare: config.prepare,
    save: (next, base) => desktop.saveUserConfig(next, base),
    getLatestConfig: () => desktop.userConfig,
    loadConfig: async () => {
      await desktop.loadDesktopState()
      return desktop.userConfig
    },
    canSave: () =>
      Math.max(
        session.draft.value.configVersion,
        session.latestConfig.value.configVersion
      ) <= CONFIG_VERSION,
    notifyError: (error) =>
      toastText(
        error
          ? `${translate('toast.settingsSaveFailed')}: ${error}`
          : translate('toast.settingsSaveFailed'),
        'error'
      ),
    debounceMs: 500,
  })
  watch(() => desktop.userConfig, session.applyIncoming)
  watch(session.draft, session.schedule, { deep: true, flush: 'sync' })
  onScopeDispose(() => {
    void session.dispose()
  })
  return session
})
