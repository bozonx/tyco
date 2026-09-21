import { beforeEach, describe, expect, it } from 'vitest'

import {
  APPEARANCE_STORAGE_KEY,
  applyAppearanceToDocument,
  readStoredAppearance,
  writeStoredAppearance,
} from './document-appearance'
import { DEFAULT_APPEARANCE } from '@tyco/shared/appearance'

describe('document-appearance storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns null when nothing is stored', () => {
    expect(readStoredAppearance(window.localStorage)).toBeNull()
  })

  it('round-trips settings', () => {
    const settings = { ...DEFAULT_APPEARANCE, theme: 'e-ink' as const }

    writeStoredAppearance(window.localStorage, settings)

    expect(readStoredAppearance(window.localStorage)).toEqual(settings)
  })

  it('migrates the legacy theme key', () => {
    window.localStorage.setItem('theme', 'dark')

    expect(readStoredAppearance(window.localStorage)).toEqual({
      ...DEFAULT_APPEARANCE,
      theme: 'dark',
    })

    writeStoredAppearance(window.localStorage, DEFAULT_APPEARANCE)

    expect(window.localStorage.getItem('theme')).toBeNull()
  })

  it('survives malformed JSON', () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, '{oops')

    expect(readStoredAppearance(window.localStorage)).toBeNull()
  })
})

describe('applyAppearanceToDocument', () => {
  it('sets theme attributes, color scheme and scale', () => {
    const root = document.createElement('html')

    applyAppearanceToDocument(root, {
      theme: 'dark',
      contrast: 'more',
      motion: 'reduce',
      uiScale: 150,
    })

    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.getAttribute('data-contrast')).toBe('more')
    expect(root.getAttribute('data-motion')).toBe('reduce')
    expect(root.style.colorScheme).toBe('dark')
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.5')
  })

  it('uses a light color scheme for e-ink', () => {
    const root = document.createElement('html')

    applyAppearanceToDocument(root, {
      theme: 'e-ink',
      contrast: 'more',
      motion: 'reduce',
      uiScale: 100,
    })

    expect(root.style.colorScheme).toBe('light')
  })
})
