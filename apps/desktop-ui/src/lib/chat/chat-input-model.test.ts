import { describe, expect, it } from 'vitest'

import { createChatInputModel } from './chat-input-model'

describe('chat input model', () => {
  it('replaces the remembered selection and requests focus at the inserted text', () => {
    const input = createChatInputModel()
    input.setValue('one two three')
    input.rememberSelection({ start: 4, end: 7 })
    input.insertText('new')
    expect(input.value.value).toBe('one new three')
    expect(input.selection.value).toEqual({ start: 7, end: 7 })
    expect(input.focusRequestCount.value).toBe(1)
    expect(input.takePendingCaret()).toBe(7)
    expect(input.takePendingCaret()).toBeNull()
  })

  it.each(['clear', 'setValue'] as const)(
    'drops a stale caret and selection on %s',
    (action) => {
      const input = createChatInputModel()
      input.insertText('old')
      if (action === 'clear') input.clear()
      else input.setValue('replacement')
      expect(input.selection.value).toBeNull()
      expect(input.takePendingCaret()).toBeNull()
      input.insertText('next')
      expect(input.value.value).toBe(
        action === 'clear' ? 'next' : 'replacement next'
      )
    }
  )

  it('does not share state between instances', () => {
    const first = createChatInputModel()
    first.insertText('draft')
    expect(createChatInputModel().value.value).toBe('')
  })
})
