import { describe, expect, it, vi } from 'vitest'

import { createThemeController, type ThemeRuntime } from './theme-controller'
import {
  DEFAULT_APPEARANCE,
  type AppearanceSettings,
  type SystemAppearance,
} from '@tyco/shared/appearance'

function createRuntime(
  options: {
    stored?: AppearanceSettings | null
    system?: Partial<SystemAppearance>
  } = {}
): ThemeRuntime {
  let stored = options.stored ?? null
  const system: SystemAppearance = {
    prefersDark: false,
    prefersMoreContrast: false,
    prefersReducedMotion: false,
    ...options.system,
  }

  return {
    getStoredAppearance: vi.fn(() => stored),
    setStoredAppearance: vi.fn((settings: AppearanceSettings) => {
      stored = settings
    }),
    getSystemAppearance: vi.fn(() => system),
    onSystemAppearanceChange: vi.fn(() => () => {}),
    applyAppearance: vi.fn(),
  }
}

describe('theme-controller', () => {
  it('uses default settings when nothing is stored', () => {
    const controller = createThemeController(createRuntime())

    expect(controller.resolveInitialSettings()).toEqual(DEFAULT_APPEARANCE)
  })

  it('prefers stored settings', () => {
    const stored: AppearanceSettings = {
      ...DEFAULT_APPEARANCE,
      theme: 'dark',
      uiScale: 130,
    }
    const controller = createThemeController(createRuntime({ stored }))

    expect(controller.resolveInitialSettings()).toEqual(stored)
  })

  it('resolves auto values against system preferences', () => {
    const controller = createThemeController(
      createRuntime({
        system: {
          prefersDark: true,
          prefersMoreContrast: true,
          prefersReducedMotion: true,
        },
      })
    )

    expect(controller.resolve(DEFAULT_APPEARANCE)).toEqual({
      theme: 'dark',
      contrast: 'more',
      motion: 'reduce',
      uiScale: 100,
    })
  })

  it('persists and applies settings on change', () => {
    const runtime = createRuntime()
    const controller = createThemeController(runtime)
    const settings: AppearanceSettings = {
      ...DEFAULT_APPEARANCE,
      theme: 'light',
      contrast: 'more',
    }

    const resolved = controller.setSettings(settings)

    expect(runtime.setStoredAppearance).toHaveBeenCalledWith(settings)
    expect(runtime.applyAppearance).toHaveBeenCalledWith(resolved)
    expect(resolved).toMatchObject({ theme: 'light', contrast: 'more' })
  })

  it('applies without persisting', () => {
    const runtime = createRuntime()
    const controller = createThemeController(runtime)

    controller.applySettings(DEFAULT_APPEARANCE)

    expect(runtime.setStoredAppearance).not.toHaveBeenCalled()
    expect(runtime.applyAppearance).toHaveBeenCalledOnce()
  })
})
