import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'
import { CONFIG_VERSION } from '@tyco/shared'

import useToast from '../composables/use-toast'
import { translate } from '../lib/i18n'
import { createSettingsConfig } from '../lib/settings/settings-config'
import { createSettingsSession } from '../lib/settings/settings-session'
import { usePlugins } from '../plugins'
import { useActionMenuStore } from './action-menu'
import { useIpcStore } from './ipc'
import { useThemeStore } from './theme'

/** Owns the draft across settings navigation, including failed final saves. */
export const useSettingsSessionStore = defineStore('settingsSession', () => {
  const ipc = useIpcStore()
  const { pluginIndexes } = usePlugins()
  const actions = useActionMenuStore()
  const theme = useThemeStore()
  const { toastText } = useToast()
  const config = createSettingsConfig({
    resolveMainActions: actions.resolveMainActions,
    getRegisteredActions: actions.getRegisteredActions,
    pluginIndexes: () => pluginIndexes,
    appearance: () => theme.settings,
  })
  const session = createSettingsSession({
    initialConfig: ipc.params.userConfig,
    prepare: config.prepare,
    save: (next, base) => ipc.saveUserConfig(next, base),
    canSave: () => (session.draft.value.configVersion ?? 0) <= CONFIG_VERSION,
    notifyError: (error) =>
      toastText(
        error
          ? `${translate('toast.settingsSaveFailed')}: ${error}`
          : translate('toast.settingsSaveFailed'),
        'error'
      ),
    debounceMs: 500,
  })
  watch(() => ipc.params.userConfig, session.applyIncoming)
  watch(session.draft, session.schedule, { deep: true })
  onScopeDispose(() => {
    void session.dispose()
  })
  return session
})
