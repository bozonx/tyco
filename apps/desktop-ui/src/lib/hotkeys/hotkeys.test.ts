import { describe, expect, it } from 'vitest'

import { hotkeyFromKeyboardEvent, normalizeHotkey } from '@tyco/shared'

describe('hotkeys', () => {
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
})
