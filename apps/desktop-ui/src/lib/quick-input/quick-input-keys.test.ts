import { describe, expect, it } from 'vitest'
import { DEFAULT_QUICK_INPUT_HOTKEYS } from '@tyco/shared'
import {
  quickInputShortcut,
  resolveQuickInputHotkeys,
  resolveQuickInputKeyAction,
} from './quick-input-keys'

describe('quick input shortcuts', () => {
  it('uses explicit actions and exact modifiers', () => {
    expect(resolveQuickInputKeyAction({ code: 'Enter' })).toBe(
      'correctAndInsert'
    )
    expect(resolveQuickInputKeyAction({ code: 'Tab' })).toBe('next')
    expect(resolveQuickInputKeyAction({ code: 'Enter', shiftKey: true })).toBe(
      'newline'
    )
    expect(resolveQuickInputKeyAction({ code: 'Escape' })).toBe('cancel')
    expect(resolveQuickInputKeyAction({ code: 'Enter', altKey: true })).toBe(
      'none'
    )
    expect(resolveQuickInputKeyAction({ code: 'Enter', ctrlKey: true })).toBe(
      'none'
    )
    expect(resolveQuickInputKeyAction({ code: 'Tab', shiftKey: true })).toBe(
      'none'
    )
  })

  it('matches physical keys in other layouts and leaves composition alone', () => {
    const keys = resolveQuickInputHotkeys({ next: 'Ctrl+S' })
    expect(
      resolveQuickInputKeyAction(
        { code: 'KeyS', key: '\u044b', ctrlKey: true },
        keys
      )
    ).toBe('next')
    expect(
      resolveQuickInputKeyAction({ code: 'Enter', isComposing: true })
    ).toBe('none')
    expect(quickInputShortcut({ code: 'KeyS', key: 's' })).toBeNull()
  })

  it('supports reassignment without keeping old shortcuts active', () => {
    const keys = resolveQuickInputHotkeys({
      correctAndInsert: 'Ctrl+Enter',
      next: 'Alt+S',
      insertWithoutCorrection: 'Ctrl+Shift+Enter',
    })
    expect(resolveQuickInputKeyAction({ code: 'Enter' }, keys)).toBe('none')
    expect(
      resolveQuickInputKeyAction({ code: 'Enter', ctrlKey: true }, keys)
    ).toBe('correctAndInsert')
    expect(
      resolveQuickInputKeyAction({ code: 'KeyS', altKey: true }, keys)
    ).toBe('next')
    expect(
      resolveQuickInputKeyAction(
        { code: 'Enter', ctrlKey: true, shiftKey: true },
        keys
      )
    ).toBe('insertWithoutCorrection')
  })

  it('normalizes saved keys and recovers from malformed or conflicting config', () => {
    expect(resolveQuickInputHotkeys({ next: 'control+s' }).next).toBe('Ctrl+S')
    expect(resolveQuickInputHotkeys({ next: 'Tab' }).next).toBe('Tab')
    expect(resolveQuickInputHotkeys({ cancel: 'escape' }).cancel).toBe('Esc')
    expect(resolveQuickInputHotkeys({ cancel: 'Esc' }).cancel).toBe('Esc')
    expect(resolveQuickInputHotkeys({ next: 'Enter' })).toEqual(
      DEFAULT_QUICK_INPUT_HOTKEYS
    )
    expect(resolveQuickInputHotkeys({ next: 's', cancel: '' })).toEqual(
      DEFAULT_QUICK_INPUT_HOTKEYS
    )
  })
})
