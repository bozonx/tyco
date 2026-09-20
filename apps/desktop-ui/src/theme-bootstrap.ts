/**
 * Applies the persisted theme before the app renders to avoid a flash of the
 * wrong color scheme. Loaded as a module script from `index.html`, so it must
 * not import anything that pulls in the application bundle.
 */
type ThemeMode = 'auto' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'theme'

function readThemeMode(): ThemeMode {
  let stored: string | null

  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    stored = null
  }

  return stored === 'auto' || stored === 'light' || stored === 'dark'
    ? stored
    : 'auto'
}

const themeMode = readThemeMode()
const prefersDark =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches
const resolvedTheme =
  themeMode === 'auto' ? (prefersDark ? 'dark' : 'light') : themeMode

document.documentElement.setAttribute('data-theme', resolvedTheme)
document.documentElement.setAttribute('data-theme-mode', themeMode)
document.documentElement.style.colorScheme = resolvedTheme
