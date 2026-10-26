import { describe, expect, it } from 'vitest'
import { adaptModShortcuts } from './mod-shortcuts'

describe('adaptModShortcuts', () => {
  it('replaces Ctrl with Cmd on macOS', () => {
    expect(adaptModShortcuts('Send right away (Ctrl+Enter)', true)).toBe(
      'Send right away (Cmd+Enter)'
    )
    expect(
      adaptModShortcuts('Switch to formatted text (Ctrl+Shift+M)', true)
    ).toBe('Switch to formatted text (Cmd+Shift+M)')
    expect(adaptModShortcuts('Find and replace (Ctrl+F / Ctrl+H)', true)).toBe(
      'Find and replace (Cmd+F / Cmd+H)'
    )
  })

  it('keeps Ctrl on non-macOS', () => {
    expect(adaptModShortcuts('Send right away (Ctrl+Enter)', false)).toBe(
      'Send right away (Ctrl+Enter)'
    )
  })
})
