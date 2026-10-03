import { describe, expect, it } from 'vitest'

import { recordKeyDown, shortcutKeys } from './hotkey-recorder'

const event = (
  key: string,
  code: string,
  modifiers: Partial<
    Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>
  > = {}
) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
})

describe('hotkey recorder', () => {
  it('shows the modifiers held so far', () => {
    expect(
      recordKeyDown(event('Alt', 'AltLeft', { ctrlKey: true, altKey: true }))
    ).toEqual({ kind: 'pending', keys: ['Ctrl', 'Alt'] })
  })

  it('completes a shortcut on the first non-modifier key', () => {
    expect(
      recordKeyDown(event('у', 'KeyE', { ctrlKey: true, altKey: true }))
    ).toEqual({ kind: 'done', shortcut: 'Ctrl+Alt+E' })
  })

  it('cancels on a bare Escape only', () => {
    expect(recordKeyDown(event('Escape', 'Escape'))).toEqual({ kind: 'cancel' })
    expect(recordKeyDown(event('Escape', 'Escape', { ctrlKey: true }))).toEqual(
      { kind: 'done', shortcut: 'Ctrl+Escape' }
    )
  })

  it('rejects a key without modifiers', () => {
    expect(recordKeyDown(event('a', 'KeyA'))).toEqual({
      kind: 'invalid',
      keys: ['A'],
    })
  })

  it('splits a stored shortcut into keys', () => {
    expect(shortcutKeys('Ctrl+Alt+E')).toEqual(['Ctrl', 'Alt', 'E'])
    expect(shortcutKeys('')).toEqual([])
  })
})
