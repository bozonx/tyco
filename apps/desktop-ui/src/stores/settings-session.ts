import { defineStore } from 'pinia'
import { computed, onScopeDispose, watch } from 'vue'
import { CONFIG_VERSION } from '@tyco/shared'

import { useToastStore } from './toast'
import { translate } from '../lib/i18n'
import { AUTOSAVE_DELAY_MS } from '../lib/settings/autosave'
import { createSettingsConfig } from '../lib/settings/settings-config'
import { createSettingsSession } from '../lib/settings/settings-session'
import { usePluginRuntimeStore } from './plugin-runtime'
import { useDesktopStore } from './desktop'
import { useThemeStore } from './theme'

/** Saves a draft kept outside the config; false when it could not be saved */
export type DraftFlush = () => Promise<boolean>

/** Owns the draft across settings navigation, including failed final saves. */
export const useSettingsSessionStore = defineStore('settingsSession', () => {
  const desktop = useDesktopStore()
  const { pluginFactories } = usePluginRuntimeStore()
  const theme = useThemeStore()
  const { toastText } = useToastStore()
  const config = createSettingsConfig({
    pluginFactories: () => pluginFactories,
    appearance: () => theme.settings,
  })
  const session = createSettingsSession({
    initialConfig: desktop.savedUserConfig,
    prepare: config.prepare,
    save: (next, base) => desktop.saveUserConfig(next, base),
    getLatestConfig: () => desktop.savedUserConfig,
    loadConfig: async () => {
      await desktop.loadDesktopState()
      return desktop.savedUserConfig
    },
    // the draft is normalized to the current version; only the stored
    // config tells that a newer build wrote it
    canSave: () => session.latestConfig.value.configVersion <= CONFIG_VERSION,
    notifyError: (error) =>
      toastText(
        error
          ? `${translate('toast.settingsSaveFailed')}: ${error}`
          : translate('toast.settingsSaveFailed'),
        'error'
      ),
    notifyConflict: () =>
      toastText(translate('settings.saveConflictToast'), 'warn'),
    debounceMs: AUTOSAVE_DELAY_MS,
  })
  watch(() => desktop.savedUserConfig, session.applyIncoming)
  watch(session.draft, session.schedule, { deep: true, flush: 'sync' })
  onScopeDispose(() => {
    void session.dispose()
  })

  /** A newer build wrote the config: it is shown but never written over */
  const isConfigNewer = computed(
    () => (session.latestConfig.value.configVersion ?? 0) > CONFIG_VERSION
  )

  // drafts saved apart from the config, e.g. of an AI profile being edited
  const draftFlushes = new Set<DraftFlush>()
  /** Has `flush` run with the others on exit; returns the unregistration */
  const registerDraft = (flush: DraftFlush) => {
    draftFlushes.add(flush)
    return () => {
      draftFlushes.delete(flush)
    }
  }
  /** Saves every pending draft now, e.g. on exit; false when one failed */
  const flushAll = async (): Promise<boolean> => {
    const [, ...saved] = await Promise.all([
      session.persist(),
      ...[...draftFlushes].map((flush) => flush().catch(() => false)),
    ])
    return session.isSaved() && saved.every(Boolean)
  }

  return { ...session, isConfigNewer, registerDraft, flushAll }
})
