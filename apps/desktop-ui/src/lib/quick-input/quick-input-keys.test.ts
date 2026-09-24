import { describe, expect, it } from 'vitest'

import { resolveQuickInputKeyAction } from './quick-input-keys'

describe('resolveQuickInputKeyAction', () => {
  it('returns cancel on Escape regardless of submit mode', () => {
    expect(resolveQuickInputKeyAction({ code: 'Escape' }, 'enter')).toBe(
      'cancel'
    )
    expect(resolveQuickInputKeyAction({ code: 'Escape' }, 'ctrlEnter')).toBe(
      'cancel'
    )
  })

  it('returns to-editor on Tab regardless of submit mode', () => {
    expect(resolveQuickInputKeyAction({ code: 'Tab' }, 'enter')).toBe(
      'to-editor'
    )
    expect(resolveQuickInputKeyAction({ code: 'Tab' }, 'ctrlEnter')).toBe(
      'to-editor'
    )
  })

  describe('in "enter" submit mode', () => {
    it('submits on regular Enter', () => {
      expect(resolveQuickInputKeyAction({ code: 'Enter' }, 'enter')).toBe(
        'submit'
      )
    })

    it('submits on Ctrl+Enter or Meta+Enter as alias', () => {
      expect(
        resolveQuickInputKeyAction({ code: 'Enter', ctrlKey: true }, 'enter')
      ).toBe('submit')
      expect(
        resolveQuickInputKeyAction({ code: 'Enter', metaKey: true }, 'enter')
      ).toBe('submit')
    })

    it('returns none on Shift+Enter allowing newline', () => {
      expect(
        resolveQuickInputKeyAction({ code: 'Enter', shiftKey: true }, 'enter')
      ).toBe('none')
    })
  })

  describe('in "ctrlEnter" submit mode', () => {
    it('returns none on regular Enter allowing newline', () => {
      expect(resolveQuickInputKeyAction({ code: 'Enter' }, 'ctrlEnter')).toBe(
        'none'
      )
    })

    it('submits on Ctrl+Enter', () => {
      expect(
        resolveQuickInputKeyAction(
          { code: 'Enter', ctrlKey: true },
          'ctrlEnter'
        )
      ).toBe('submit')
    })

    it('submits on Meta+Enter', () => {
      expect(
        resolveQuickInputKeyAction(
          { code: 'Enter', metaKey: true },
          'ctrlEnter'
        )
      ).toBe('submit')
    })

    it('returns none on Shift+Enter', () => {
      expect(
        resolveQuickInputKeyAction(
          { code: 'Enter', shiftKey: true },
          'ctrlEnter'
        )
      ).toBe('none')
    })
  })

  it('returns none for other keys', () => {
    expect(resolveQuickInputKeyAction({ code: 'KeyA' })).toBe('none')
    expect(resolveQuickInputKeyAction({ code: 'Space' })).toBe('none')
    expect(resolveQuickInputKeyAction({ code: 'Backspace' })).toBe('none')
  })
})
