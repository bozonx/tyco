import { describe, expect, it } from 'vitest'

import {
  isCtrlEnter,
  newlineShortcut,
  resolveInputKeyAction,
  resolveSubmitKey,
  submitShortcut,
} from './input-keys'

describe('input keys', () => {
  it('sends with Enter by default and breaks lines with Shift+Enter', () => {
    expect(resolveInputKeyAction({ code: 'Enter' })).toBe('submit')
    expect(resolveInputKeyAction({ code: 'NumpadEnter' })).toBe('submit')
    expect(resolveInputKeyAction({ code: 'Enter', shiftKey: true })).toBe(
      'newline'
    )
    expect(resolveInputKeyAction({ code: 'Enter', ctrlKey: true })).toBe('none')
    expect(resolveInputKeyAction({ code: 'Enter', altKey: true })).toBe('none')
  })

  it('swaps Enter and Ctrl+Enter in the Ctrl+Enter mode', () => {
    const mode = 'Ctrl+Enter'
    expect(resolveInputKeyAction({ code: 'Enter', ctrlKey: true }, mode)).toBe(
      'submit'
    )
    expect(resolveInputKeyAction({ code: 'Enter', metaKey: true }, mode)).toBe(
      'submit'
    )
    expect(resolveInputKeyAction({ code: 'Enter' }, mode)).toBe('newline')
    expect(resolveInputKeyAction({ code: 'Enter', shiftKey: true }, mode)).toBe(
      'newline'
    )
  })

  it('keeps Tab and Esc fixed in both modes', () => {
    for (const mode of ['Enter', 'Ctrl+Enter'] as const) {
      expect(resolveInputKeyAction({ code: 'Tab' }, mode)).toBe('actions')
      expect(resolveInputKeyAction({ code: 'Escape' }, mode)).toBe('cancel')
    }
    expect(resolveInputKeyAction({ code: 'Tab', shiftKey: true })).toBe('none')
    expect(resolveInputKeyAction({ code: 'KeyS', ctrlKey: true })).toBe('none')
  })

  it('ignores keys of an IME composition', () => {
    expect(resolveInputKeyAction({ code: 'Enter', isComposing: true })).toBe(
      'none'
    )
    expect(
      isCtrlEnter({ code: 'Enter', ctrlKey: true, isComposing: true })
    ).toBe(false)
  })

  it('recognizes Ctrl+Enter and Cmd+Enter only', () => {
    expect(isCtrlEnter({ code: 'Enter', ctrlKey: true })).toBe(true)
    expect(isCtrlEnter({ code: 'Enter', metaKey: true })).toBe(true)
    expect(isCtrlEnter({ code: 'Enter', ctrlKey: true, shiftKey: true })).toBe(
      false
    )
    expect(isCtrlEnter({ code: 'Enter' })).toBe(false)
  })

  it('falls back to Enter for unknown saved values', () => {
    expect(resolveSubmitKey('Ctrl+Enter')).toBe('Ctrl+Enter')
    expect(resolveSubmitKey('Enter')).toBe('Enter')
    expect(resolveSubmitKey('ctrlEnter')).toBe('Enter')
    expect(resolveSubmitKey(undefined)).toBe('Enter')
  })

  it('labels the keys of each mode', () => {
    expect(submitShortcut('Enter')).toBe('Enter')
    expect(newlineShortcut('Enter')).toBe('Shift+Enter')
    expect(submitShortcut('Ctrl+Enter')).toBe('Ctrl+Enter')
    expect(newlineShortcut('Ctrl+Enter')).toBe('Enter')
  })
})
