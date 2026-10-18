import { defineStore } from 'pinia'
import { onScopeDispose, ref, watchEffect } from 'vue'
import { browserThemeRuntime } from '../lib/theme/browser-theme-runtime'
import { createThemeController } from '../lib/theme/theme-controller'
import { useDesktopStore } from './desktop'
import { normalizeAppearance } from '@tyco/shared/appearance'

export const useThemeStore = defineStore('theme', () => {
  const desktopStore = useDesktopStore()
  const controller = createThemeController(browserThemeRuntime)
  const settings = ref(controller.resolveInitialSettings())
  const resolved = ref(controller.applySettings(settings.value))

  watchEffect(() => {
    const userConfig = desktopStore.userConfig

    // Until the config arrives keep what the bootstrap applied from storage.
    if (!userConfig) {
      return
    }

    settings.value = normalizeAppearance(userConfig.appearance)
    resolved.value = controller.setSettings(settings.value)
  })

  const stopSystemAppearance = controller.onSystemAppearanceChange(() => {
    resolved.value = controller.applySettings(settings.value)
  })

  onScopeDispose(stopSystemAppearance)

  return { settings, resolved }
})
