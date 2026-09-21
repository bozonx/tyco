import { describe, expect, it } from 'vitest'

import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  resolveAppearance,
  type SystemAppearance,
} from '@tyco/shared/appearance'

const NO_PREFERENCES: SystemAppearance = {
  prefersDark: false,
  prefersMoreContrast: false,
  prefersReducedMotion: false,
}

describe('normalizeAppearance', () => {
  it('keeps valid values and ignores unrelated fields', () => {
    expect(
      normalizeAppearance({
        theme: 'e-ink',
        contrast: 'normal',
        motion: 'reduce',
        uiScale: 150,
        pasteMode: 'plain',
      })
    ).toEqual({
      theme: 'e-ink',
      contrast: 'normal',
      motion: 'reduce',
      uiScale: 150,
    })
  })

  it('replaces invalid or missing values with defaults', () => {
    expect(
      normalizeAppearance({ theme: 'sepia', contrast: 1, uiScale: 123 })
    ).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
  })

  it('accepts a numeric scale stored as a string', () => {
    expect(normalizeAppearance({ uiScale: '175' }).uiScale).toBe(175)
  })
})

describe('resolveAppearance', () => {
  it('follows the system in auto mode', () => {
    expect(
      resolveAppearance(DEFAULT_APPEARANCE, {
        prefersDark: true,
        prefersMoreContrast: true,
        prefersReducedMotion: true,
      })
    ).toEqual({
      theme: 'dark',
      contrast: 'more',
      motion: 'reduce',
      uiScale: 100,
    })
    expect(resolveAppearance(DEFAULT_APPEARANCE, NO_PREFERENCES)).toEqual({
      theme: 'light',
      contrast: 'normal',
      motion: 'normal',
      uiScale: 100,
    })
  })

  it('lets explicit values override system preferences', () => {
    expect(
      resolveAppearance(
        { theme: 'light', contrast: 'normal', motion: 'normal', uiScale: 130 },
        {
          prefersDark: true,
          prefersMoreContrast: true,
          prefersReducedMotion: true,
        }
      )
    ).toEqual({
      theme: 'light',
      contrast: 'normal',
      motion: 'normal',
      uiScale: 130,
    })
  })

  it('forces high contrast and no motion for e-ink', () => {
    expect(
      resolveAppearance(
        { theme: 'e-ink', contrast: 'normal', motion: 'normal', uiScale: 100 },
        NO_PREFERENCES
      )
    ).toMatchObject({ theme: 'e-ink', contrast: 'more', motion: 'reduce' })
  })
})
