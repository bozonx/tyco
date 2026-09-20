export type ThemeName = 'light' | 'dark'
export type ThemeMode = 'auto' | ThemeName

export interface ThemeRuntime {
  getStoredTheme: () => ThemeMode | null
  setStoredTheme: (theme: ThemeMode) => void
  clearStoredTheme: () => void
  applyTheme: (theme: ThemeName, mode: ThemeMode) => void
  getSystemTheme: () => ThemeName
  onSystemThemeChange: (handler: (theme: ThemeName) => void) => () => void
}

export function createThemeController(runtime: ThemeRuntime) {
  const resolveTheme = (mode: ThemeMode): ThemeName => {
    return mode === 'auto' ? runtime.getSystemTheme() : mode
  }

  const resolveInitialThemeMode = (): ThemeMode => {
    return runtime.getStoredTheme() || 'auto'
  }

  const applyTheme = (mode: ThemeMode): ThemeName => {
    const resolvedTheme = resolveTheme(mode)
    runtime.applyTheme(resolvedTheme, mode)
    return resolvedTheme
  }

  const setThemeMode = (mode: ThemeMode): ThemeName => {
    if (mode === 'auto') {
      runtime.clearStoredTheme()
    } else {
      runtime.setStoredTheme(mode)
    }

    return applyTheme(mode)
  }

  const handleSystemThemeChange = (mode: ThemeMode): ThemeName | null => {
    if (mode !== 'auto') {
      return null
    }

    return applyTheme(mode)
  }

  const onSystemThemeChange = (handler: (theme: ThemeName) => void) => {
    return runtime.onSystemThemeChange(handler)
  }

  return {
    resolveInitialThemeMode,
    resolveTheme,
    applyTheme,
    setThemeMode,
    handleSystemThemeChange,
    onSystemThemeChange,
  }
}
