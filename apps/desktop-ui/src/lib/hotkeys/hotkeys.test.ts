import { describe, expect, it } from 'vitest'

import {
  DEFAULT_USER_CONFIG,
  START_MODES,
  hotkeyFromKeyboardEvent,
  normalizeHotkey,
} from '@tyco/shared'

describe('hotkeys', () => {
  it('defines a default binding for global activation modes', () => {
    const expectedModes = Object.values(START_MODES).filter(
      (mode) =>
        mode !== START_MODES.HISTORY &&
        mode !== START_MODES.CONFIG &&
        mode !== START_MODES.CORRECTION
    )
    expect(Object.keys(DEFAULT_USER_CONFIG.hotkeys).sort()).toEqual(
      expectedModes.sort()
    )
  })

  it('normalizes aliases and modifier order', () => {
    expect(normalizeHotkey('shift+command+,')).toBe('Shift+Super+Comma')
    expect(normalizeHotkey('alt+ctrl+e')).toBe('Ctrl+Alt+E')
  })

  it('rejects incomplete and ambiguous shortcuts', () => {
    expect(normalizeHotkey('Ctrl')).toBeNull()
    expect(normalizeHotkey('Ctrl+A+B')).toBeNull()
  })

  it('converts keyboard events', () => {
    expect(
      hotkeyFromKeyboardEvent({
        key: 'e',
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      })
    ).toBe('Ctrl+Alt+E')
  })

  it('records the physical key regardless of the keyboard layout', () => {
    expect(
      hotkeyFromKeyboardEvent({
        key: 'п',
        code: 'KeyG',
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      })
    ).toBe('Ctrl+Alt+G')
    expect(
      hotkeyFromKeyboardEvent({
        key: '!',
        code: 'Digit1',
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false,
      })
    ).toBe('Ctrl+Shift+1')
  })
})
