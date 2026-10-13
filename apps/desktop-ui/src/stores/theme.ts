import { defineStore } from 'pinia'
import { onScopeDispose, ref, watchEffect } from 'vue'
import { browserThemeRuntime } from '../lib/theme/browser-theme-runtime'
import { createThemeController } from '../lib/theme/theme-controller'
import { useIpcStore } from './ipc'
import { normalizeAppearance } from '@tyco/shared/appearance'

export const useThemeStore = defineStore('theme', () => {
  const ipcStore = useIpcStore()
  const controller = createThemeController(browserThemeRuntime)
  const settings = ref(controller.resolveInitialSettings())
  const resolved = ref(controller.applySettings(settings.value))

  watchEffect(() => {
    const userConfig = ipcStore.desktopState.userConfig

    // Until the config arrives keep what the bootstrap applied from storage.
    if (!userConfig) {
      return
    }

    settings.value = normalizeAppearance(userConfig)
    resolved.value = controller.setSettings(settings.value)
  })

  const stopSystemAppearance = controller.onSystemAppearanceChange(() => {
    resolved.value = controller.applySettings(settings.value)
  })

  onScopeDispose(stopSystemAppearance)

  return { settings, resolved }
})
