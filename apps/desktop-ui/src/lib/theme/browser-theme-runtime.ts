import type { ThemeMode, ThemeName, ThemeRuntime } from './theme-controller'

function readStoredTheme(): ThemeMode | null {
  const storedTheme = window.localStorage.getItem('theme')

  if (
    storedTheme === 'auto'
    || storedTheme === 'light'
    || storedTheme === 'dark'
  ) {
    return storedTheme
  }

  return null
}

function getSystemTheme(): ThemeName {
  if (
    window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark'
  }

  return 'light'
}

export const browserThemeRuntime: ThemeRuntime = {
  getStoredTheme: readStoredTheme,
  setStoredTheme: (theme) => {
    window.localStorage.setItem('theme', theme)
  },
  clearStoredTheme: () => {
    window.localStorage.removeItem('theme')
  },
  applyTheme: (theme, mode) => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-theme-mode', mode)
    document.documentElement.style.colorScheme = theme
  },
  getSystemTheme,
  onSystemThemeChange: (handler) => {
    if (!window.matchMedia) {
      return () => {}
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent) => {
      handler(event.matches ? 'dark' : 'light')
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', listener)

      return () => {
        mediaQuery.removeEventListener('change', listener)
      }
    }

    mediaQuery.addListener(listener)

    return () => {
      mediaQuery.removeListener(listener)
    }
  },
}
