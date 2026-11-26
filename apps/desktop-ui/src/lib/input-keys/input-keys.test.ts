import { describe, expect, it } from 'vitest'

import {
  isCloseWindowEvent,
  isCtrlEnter,
  isQuitEvent,
  isScreenshotShortcut,
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

  it('uses Shift+Space for actions and leaves Tab to focus in both modes', () => {
    for (const mode of ['Enter', 'Ctrl+Enter'] as const) {
      expect(
        resolveInputKeyAction({ code: 'Space', shiftKey: true }, mode)
      ).toBe('actions')
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
    expect(newlineShortcut()).toBe('Shift+Enter')
    expect(submitShortcut('Ctrl+Enter')).toBe('Ctrl+Enter')
    expect(newlineShortcut()).toBe('Shift+Enter')
  })

  it('recognizes close window shortcuts (Ctrl+W or Cmd+W) on any layout', () => {
    expect(isCloseWindowEvent({ code: 'KeyW', ctrlKey: true })).toBe(true)
    expect(isCloseWindowEvent({ code: 'KeyW', metaKey: true })).toBe(true)
    expect(isCloseWindowEvent({ key: 'w', code: 'KeyW', ctrlKey: true })).toBe(
      true
    )
    expect(isCloseWindowEvent({ key: 'ц', code: 'KeyW', ctrlKey: true })).toBe(
      true
    )
    expect(isCloseWindowEvent({ key: 'w', code: 'KeyA', ctrlKey: true })).toBe(
      true
    )
    expect(isCloseWindowEvent({ key: 'q', code: 'KeyQ', ctrlKey: true })).toBe(
      false
    )
    expect(
      isCloseWindowEvent({ code: 'KeyW', ctrlKey: true, shiftKey: true })
    ).toBe(false)
    expect(
      isCloseWindowEvent({ code: 'KeyW', ctrlKey: true, altKey: true })
    ).toBe(false)
    expect(
      isCloseWindowEvent({ code: 'KeyW', ctrlKey: true, isComposing: true })
    ).toBe(false)
    expect(isCloseWindowEvent({ code: 'KeyW' })).toBe(false)
  })

  it('recognizes quit shortcuts (Ctrl+Q or Cmd+Q) on any layout', () => {
    expect(isQuitEvent({ code: 'KeyQ', ctrlKey: true })).toBe(true)
    expect(isQuitEvent({ code: 'KeyQ', metaKey: true })).toBe(true)
    expect(isQuitEvent({ key: 'q', code: 'KeyQ', ctrlKey: true })).toBe(true)
    expect(isQuitEvent({ key: 'й', code: 'KeyQ', ctrlKey: true })).toBe(true)
    expect(isQuitEvent({ key: 'q', code: 'KeyA', ctrlKey: true })).toBe(true)
    expect(isQuitEvent({ key: 'w', code: 'KeyW', ctrlKey: true })).toBe(false)
    expect(isQuitEvent({ code: 'KeyQ', ctrlKey: true, shiftKey: true })).toBe(
      false
    )
    expect(isQuitEvent({ code: 'KeyQ', ctrlKey: true, altKey: true })).toBe(
      false
    )
    expect(
      isQuitEvent({ code: 'KeyQ', ctrlKey: true, isComposing: true })
    ).toBe(false)
    expect(isQuitEvent({ code: 'KeyQ' })).toBe(false)
  })

  it('recognizes screenshot shortcuts (Ctrl+Shift+S or Cmd+Shift+S) on any layout', () => {
    expect(
      isScreenshotShortcut({ code: 'KeyS', ctrlKey: true, shiftKey: true })
    ).toBe(true)
    expect(
      isScreenshotShortcut({ code: 'KeyS', metaKey: true, shiftKey: true })
    ).toBe(true)
    expect(
      isScreenshotShortcut({
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        shiftKey: true,
      })
    ).toBe(true)
    expect(
      isScreenshotShortcut({
        key: 'ы',
        code: 'KeyS',
        ctrlKey: true,
        shiftKey: true,
      })
    ).toBe(true)
    expect(
      isScreenshotShortcut({
        key: 's',
        code: 'KeyA',
        ctrlKey: true,
        shiftKey: true,
      })
    ).toBe(true)
    expect(
      isScreenshotShortcut({ code: 'KeyS', ctrlKey: true, shiftKey: false })
    ).toBe(false)
    expect(
      isScreenshotShortcut({
        code: 'KeyS',
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
      })
    ).toBe(false)
    expect(
      isScreenshotShortcut({
        code: 'KeyS',
        ctrlKey: true,
        shiftKey: true,
        isComposing: true,
      })
    ).toBe(false)
  })
})
