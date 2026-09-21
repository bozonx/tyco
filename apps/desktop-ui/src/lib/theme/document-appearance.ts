/**
 * DOM side of the appearance settings. Shared by the pre-render bootstrap and
 * the runtime theme store, so it must stay free of application imports.
 */
import {
  isDarkTheme,
  isThemeMode,
  normalizeAppearance,
  type AppearanceSettings,
  type ResolvedAppearance,
  type SystemAppearance,
} from '@tyco/shared/appearance'

export const APPEARANCE_STORAGE_KEY = 'appearance'
/** Key used before contrast, motion and scale settings existed */
const LEGACY_THEME_STORAGE_KEY = 'theme'

const SYSTEM_QUERIES = {
  prefersDark: '(prefers-color-scheme: dark)',
  prefersMoreContrast: '(prefers-contrast: more)',
  prefersReducedMotion: '(prefers-reduced-motion: reduce)',
} as const satisfies Record<keyof SystemAppearance, string>

export function readStoredAppearance(
  storage: Storage
): AppearanceSettings | null {
  try {
    const stored = storage.getItem(APPEARANCE_STORAGE_KEY)

    if (stored) {
      return normalizeAppearance(JSON.parse(stored))
    }

    const legacyTheme = storage.getItem(LEGACY_THEME_STORAGE_KEY)

    return isThemeMode(legacyTheme)
      ? normalizeAppearance({ theme: legacyTheme })
      : null
  } catch {
    // Storage can be unavailable (private mode, blocked site data) or hold
    // malformed JSON; either way fall back to defaults.
    return null
  }
}

export function writeStoredAppearance(
  storage: Storage,
  settings: AppearanceSettings
) {
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings))
    storage.removeItem(LEGACY_THEME_STORAGE_KEY)
  } catch {
    // Persisting is only an optimisation against a flash of the wrong theme.
  }
}

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
}

export function readSystemAppearance(): SystemAppearance {
  return {
    prefersDark: matches(SYSTEM_QUERIES.prefersDark),
    prefersMoreContrast: matches(SYSTEM_QUERIES.prefersMoreContrast),
    prefersReducedMotion: matches(SYSTEM_QUERIES.prefersReducedMotion),
  }
}

export function onSystemAppearanceChange(handler: () => void): () => void {
  if (typeof window.matchMedia !== 'function') {
    return () => {}
  }

  const mediaQueries = Object.values(SYSTEM_QUERIES).map((query) =>
    window.matchMedia(query)
  )

  for (const mediaQuery of mediaQueries) {
    mediaQuery.addEventListener('change', handler)
  }

  return () => {
    for (const mediaQuery of mediaQueries) {
      mediaQuery.removeEventListener('change', handler)
    }
  }
}

export function applyAppearanceToDocument(
  root: HTMLElement,
  appearance: ResolvedAppearance
) {
  root.setAttribute('data-theme', appearance.theme)
  root.setAttribute('data-contrast', appearance.contrast)
  root.setAttribute('data-motion', appearance.motion)
  root.style.colorScheme = isDarkTheme(appearance.theme) ? 'dark' : 'light'
  root.style.setProperty('--ui-scale', String(appearance.uiScale / 100))
}
