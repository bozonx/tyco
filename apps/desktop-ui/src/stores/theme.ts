import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'
import { browserThemeRuntime } from '../lib/theme/browser-theme-runtime'
import { createThemeController, type ThemeMode } from '../lib/theme/theme-controller'
import { useIpcStore } from './ipc'

export const useThemeStore = defineStore('theme', () => {
  const ipcStore = useIpcStore()
  const controller = createThemeController(browserThemeRuntime)
  const themeMode = ref(controller.resolveInitialThemeMode())
  const theme = ref(controller.applyTheme(themeMode.value))

  watchEffect(() => {
    const nextMode = ipcStore.params.userConfig?.theme
    const resolvedMode: ThemeMode =
      nextMode === 'light' || nextMode === 'dark' || nextMode === 'auto'
        ? nextMode
        : controller.resolveInitialThemeMode()

    themeMode.value = resolvedMode
    theme.value = controller.setThemeMode(resolvedMode)
  })

  controller.onSystemThemeChange(() => {
    const nextTheme = controller.handleSystemThemeChange(themeMode.value)

    if (!nextTheme) {
      return
    }

    theme.value = nextTheme
  })

  return {
    theme,
    themeMode,
  }
})
