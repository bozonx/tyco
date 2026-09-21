/**
 * Appearance settings: the single source of truth for theme names and the
 * accessibility modifiers applied on top of any theme.
 *
 * Kept free of imports so the pre-render theme bootstrap can use it without
 * pulling in the rest of the shared package.
 */

export const THEME_MODES = ['auto', 'light', 'dark', 'e-ink'] as const
export type ThemeMode = (typeof THEME_MODES)[number]
/** A concrete palette, i.e. a value of `data-theme` */
export type ThemeName = Exclude<ThemeMode, 'auto'>

export const CONTRAST_MODES = ['auto', 'normal', 'more'] as const
export type ContrastMode = (typeof CONTRAST_MODES)[number]
export type ContrastLevel = Exclude<ContrastMode, 'auto'>

export const MOTION_MODES = ['auto', 'normal', 'reduce'] as const
export type MotionMode = (typeof MOTION_MODES)[number]
export type MotionLevel = Exclude<MotionMode, 'auto'>

/** Interface scale in percent of the default root font size */
export const UI_SCALES = [100, 115, 130, 150, 175, 200] as const
export type UiScale = (typeof UI_SCALES)[number]

export interface AppearanceSettings {
  theme: ThemeMode
  contrast: ContrastMode
  motion: MotionMode
  uiScale: UiScale
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'auto',
  contrast: 'auto',
  motion: 'auto',
  uiScale: 100,
}

function includes<T extends string | number>(
  list: readonly T[],
  value: unknown
): value is T {
  return (list as readonly unknown[]).includes(value)
}

export const isThemeMode = (value: unknown): value is ThemeMode =>
  includes(THEME_MODES, value)

export const isContrastMode = (value: unknown): value is ContrastMode =>
  includes(CONTRAST_MODES, value)

export const isMotionMode = (value: unknown): value is MotionMode =>
  includes(MOTION_MODES, value)

export const isUiScale = (value: unknown): value is UiScale =>
  includes(UI_SCALES, value)

/** Picks valid appearance fields from untrusted input, filling in defaults */
export function normalizeAppearance(value: unknown): AppearanceSettings {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<
    Record<keyof AppearanceSettings, unknown>
  >
  const uiScale = Number(source.uiScale)

  return {
    theme: isThemeMode(source.theme) ? source.theme : DEFAULT_APPEARANCE.theme,
    contrast: isContrastMode(source.contrast)
      ? source.contrast
      : DEFAULT_APPEARANCE.contrast,
    motion: isMotionMode(source.motion)
      ? source.motion
      : DEFAULT_APPEARANCE.motion,
    uiScale: isUiScale(uiScale) ? uiScale : DEFAULT_APPEARANCE.uiScale,
  }
}

/** System preferences the `auto` values resolve against */
export interface SystemAppearance {
  prefersDark: boolean
  prefersMoreContrast: boolean
  prefersReducedMotion: boolean
}

export interface ResolvedAppearance {
  theme: ThemeName
  contrast: ContrastLevel
  motion: MotionLevel
  uiScale: UiScale
}

/**
 * Turns user settings into the concrete values applied to the document. E-ink
 * panels have few gray levels and a slow refresh, so that theme always gets
 * high contrast and no motion.
 */
export function resolveAppearance(
  settings: AppearanceSettings,
  system: SystemAppearance
): ResolvedAppearance {
  const theme: ThemeName =
    settings.theme === 'auto'
      ? system.prefersDark
        ? 'dark'
        : 'light'
      : settings.theme
  const isEInk = theme === 'e-ink'

  const contrast: ContrastLevel =
    isEInk || settings.contrast === 'more'
      ? 'more'
      : settings.contrast === 'normal'
        ? 'normal'
        : system.prefersMoreContrast
          ? 'more'
          : 'normal'

  const motion: MotionLevel =
    isEInk || settings.motion === 'reduce'
      ? 'reduce'
      : settings.motion === 'normal'
        ? 'normal'
        : system.prefersReducedMotion
          ? 'reduce'
          : 'normal'

  return { theme, contrast, motion, uiScale: settings.uiScale }
}

/** Light-on-dark palettes; drives the `color-scheme` of native controls */
export function isDarkTheme(theme: ThemeName): boolean {
  return theme === 'dark'
}
