import {
  DEFAULT_APPEARANCE,
  resolveAppearance,
  type AppearanceSettings,
  type ResolvedAppearance,
  type SystemAppearance,
} from '@tyco/shared/appearance'

export interface ThemeRuntime {
  getStoredAppearance: () => AppearanceSettings | null
  setStoredAppearance: (settings: AppearanceSettings) => void
  getSystemAppearance: () => SystemAppearance
  onSystemAppearanceChange: (handler: () => void) => () => void
  applyAppearance: (appearance: ResolvedAppearance) => void
}

export function createThemeController(runtime: ThemeRuntime) {
  const resolveInitialSettings = (): AppearanceSettings => {
    return runtime.getStoredAppearance() ?? { ...DEFAULT_APPEARANCE }
  }

  const resolve = (settings: AppearanceSettings): ResolvedAppearance => {
    return resolveAppearance(settings, runtime.getSystemAppearance())
  }

  const applySettings = (settings: AppearanceSettings): ResolvedAppearance => {
    const resolved = resolve(settings)
    runtime.applyAppearance(resolved)
    return resolved
  }

  /** Persists settings for the pre-render bootstrap and applies them */
  const setSettings = (settings: AppearanceSettings): ResolvedAppearance => {
    runtime.setStoredAppearance(settings)
    return applySettings(settings)
  }

  const onSystemAppearanceChange = (handler: () => void) => {
    return runtime.onSystemAppearanceChange(handler)
  }

  return {
    resolveInitialSettings,
    resolve,
    applySettings,
    setSettings,
    onSystemAppearanceChange,
  }
}
