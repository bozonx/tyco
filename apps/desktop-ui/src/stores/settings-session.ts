import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'
import { CONFIG_VERSION } from '@tyco/shared'

import useToast from '../composables/use-toast'
import { translate } from '../lib/i18n'
import { createSettingsConfig } from '../lib/settings/settings-config'
import { createSettingsSession } from '../lib/settings/settings-session'
import { usePluginRuntimeStore } from './plugin-runtime'
import { useActionMenuStore } from './action-menu'
import { useIpcStore } from './ipc'
import { useThemeStore } from './theme'

/** Owns the draft across settings navigation, including failed final saves. */
export const useSettingsSessionStore = defineStore('settingsSession', () => {
  const ipc = useIpcStore()
  const { pluginFactories } = usePluginRuntimeStore()
  const actions = useActionMenuStore()
  const theme = useThemeStore()
  const { toastText } = useToast()
  const config = createSettingsConfig({
    resolveMainActions: actions.resolveMainActions,
    getRegisteredActions: actions.getRegisteredActions,
    pluginFactories: () => pluginFactories,
    appearance: () => theme.settings,
  })
  const session = createSettingsSession({
    initialConfig: ipc.desktopState.userConfig,
    prepare: config.prepare,
    save: (next, base) => ipc.saveUserConfig(next, base),
    getLatestConfig: () => ipc.desktopState.userConfig,
    loadConfig: async () => {
      await ipc.loadDesktopState()
      return ipc.desktopState.userConfig
    },
    canSave: () =>
      Math.max(
        session.draft.value.configVersion ?? 0,
        session.latestConfig.value.configVersion ?? 0
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
  watch(() => ipc.desktopState.userConfig, session.applyIncoming)
  watch(session.draft, session.schedule, { deep: true, flush: 'sync' })
  onScopeDispose(() => {
    void session.dispose()
  })
  return session
})
