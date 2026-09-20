import { describe, expect, it, vi } from 'vitest'

import {
  createThemeController,
  type ThemeMode,
  type ThemeName,
  type ThemeRuntime,
} from './theme-controller'

function createRuntime(options: {
  storedTheme?: ThemeMode | null
  systemTheme?: ThemeName
} = {}): ThemeRuntime {
  let storedTheme = options.storedTheme ?? null

  return {
    getStoredTheme: vi.fn(() => storedTheme),
    setStoredTheme: vi.fn((theme: ThemeMode) => {
      storedTheme = theme
    }),
    clearStoredTheme: vi.fn(() => {
      storedTheme = null
    }),
    applyTheme: vi.fn(),
    getSystemTheme: vi.fn(() => options.systemTheme ?? 'light'),
    onSystemThemeChange: vi.fn(() => () => {}),
  }
}

describe('theme-controller', () => {
  it('uses auto mode by default', () => {
    const runtime = createRuntime({
      systemTheme: 'dark',
    })
    const controller = createThemeController(runtime)

    expect(controller.resolveInitialThemeMode()).toBe('auto')
    expect(controller.resolveTheme('auto')).toBe('dark')
  })

  it('prefers stored theme mode over system theme', () => {
    const runtime = createRuntime({
      storedTheme: 'dark',
      systemTheme: 'light',
    })
    const controller = createThemeController(runtime)

    expect(controller.resolveInitialThemeMode()).toBe('dark')
    expect(controller.resolveTheme('dark')).toBe('dark')
  })

  it('persists explicit theme mode changes', () => {
    const runtime = createRuntime()
    const controller = createThemeController(runtime)

    const nextTheme = controller.setThemeMode('dark')

    expect(nextTheme).toBe('dark')
    expect(runtime.setStoredTheme).toHaveBeenCalledWith('dark')
    expect(runtime.applyTheme).toHaveBeenCalledWith('dark', 'dark')
  })

  it('clears stored theme when switching to auto', () => {
    const runtime = createRuntime({
      storedTheme: 'dark',
      systemTheme: 'light',
    })
    const controller = createThemeController(runtime)

    const nextTheme = controller.setThemeMode('auto')

    expect(nextTheme).toBe('light')
    expect(runtime.clearStoredTheme).toHaveBeenCalledOnce()
    expect(runtime.applyTheme).toHaveBeenCalledWith('light', 'auto')
  })

  it('reapplies theme on system theme change only in auto mode', () => {
    const runtime = createRuntime({
      systemTheme: 'dark',
    })
    const controller = createThemeController(runtime)

    expect(controller.handleSystemThemeChange('dark')).toBeNull()
    expect(controller.handleSystemThemeChange('auto')).toBe('dark')
    expect(runtime.applyTheme).toHaveBeenCalledWith('dark', 'auto')
  })
})
