import { describe, expect, it } from 'vitest'

import { isModeSwitchKey } from './quick-mode-switch'

const key = (code: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
})

describe('quick mode switch key', () => {
  it('is Alt+L alone', () => {
    expect(isModeSwitchKey(key('KeyL', { altKey: true }))).toBe(true)
    expect(isModeSwitchKey(key('KeyL'))).toBe(false)
    expect(isModeSwitchKey(key('KeyL', { altKey: true, ctrlKey: true }))).toBe(
      false
    )
    expect(isModeSwitchKey(key('Tab', { altKey: true }))).toBe(false)
  })
})
