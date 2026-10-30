import { describe, expect, it } from 'vitest'

import {
  DEFAULT_USER_CONFIG,
  ActivationMode,
  hotkeyFromKeyboardEvent,
  normalizeHotkey,
} from '@tyco/shared'

describe('hotkeys', () => {
  it('defines a default binding for global activation modes', () => {
    const expectedModes = [
      ...Object.values(ActivationMode).filter(
        (mode) =>
          mode !== ActivationMode.CONFIG &&
          mode !== ActivationMode.EXTERNAL_ACCESS &&
          mode !== ActivationMode.COMMAND_LAUNCHER
      ),
      'selectionCorrection',
    ]
    expect(Object.keys(DEFAULT_USER_CONFIG.hotkeys).sort()).toEqual(
      expectedModes.sort()
    )
  })

  it('keeps the hotkeys of the command pages on the pages', () => {
    expect(
      DEFAULT_USER_CONFIG.launcherPages.map((page) => page.hotkey)
    ).toEqual(['Ctrl+Alt+Shift+Q'])
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

  const press = (key: string, code: string) => ({
    key,
    code,
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
  })

  it('takes a Latin letter as the layout types it', () => {
    // Z of a QWERTZ keyboard sits where QWERTY has Y
    expect(hotkeyFromKeyboardEvent(press('z', 'KeyY'))).toBe('Ctrl+Alt+Z')
    // macOS binds the key position
    expect(
      hotkeyFromKeyboardEvent(press('z', 'KeyY'), { isPhysical: true })
    ).toBe('Ctrl+Alt+Y')
  })

  it('keeps numpad keys apart from the digit row', () => {
    expect(hotkeyFromKeyboardEvent(press('1', 'Numpad1'))).toBe(
      'Ctrl+Alt+Numpad1'
    )
    expect(hotkeyFromKeyboardEvent(press('F5', 'F5'))).toBe('Ctrl+Alt+F5')
    expect(hotkeyFromKeyboardEvent(press('ArrowUp', 'ArrowUp'))).toBe(
      'Ctrl+Alt+ArrowUp'
    )
  })

  it('refuses keys the global shortcuts cannot bind', () => {
    expect(hotkeyFromKeyboardEvent(press('ё', 'IntlBackslash'))).toBeNull()
  })
})
