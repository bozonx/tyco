import { START_MODES } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  createCapturedChatSelection,
  type SelectionActivation,
} from './captured-chat-selection'

function setup(getSelectedText?: () => string | undefined) {
  const startChatWithAttachment = vi.fn()
  const selection = createCapturedChatSelection({
    startChatWithAttachment,
    getSelectedText,
  })

  return { selection, startChatWithAttachment }
}

const activation = (
  overrides: Partial<SelectionActivation> = {}
): SelectionActivation => ({
  activationId: 1,
  mode: START_MODES.CHAT,
  isWindowShown: true,
  selectedText: 'Selected for chat',
  ...overrides,
})

describe('createCapturedChatSelection', () => {
  it('puts the selection of a chat activation into the chat attachments', () => {
    const { selection, startChatWithAttachment } = setup()

    expect(selection.apply(activation())).toBe(true)

    expect(startChatWithAttachment).toHaveBeenCalledWith('Selected for chat')
  })

  it('waits for the selection captured after the activation', () => {
    const { selection, startChatWithAttachment } = setup()

    expect(selection.apply(activation({ selectedText: null }))).toBe(false)
    expect(selection.apply(activation())).toBe(true)

    expect(startChatWithAttachment).toHaveBeenCalledOnce()
  })

  it('takes the selection once per activation', () => {
    const { selection, startChatWithAttachment } = setup()

    selection.apply(activation())
    selection.apply(activation())
    selection.apply(activation({ activationId: 2, selectedText: 'Next' }))

    expect(startChatWithAttachment.mock.calls).toEqual([
      ['Selected for chat'],
      ['Next'],
    ])
  })

  it('takes the editor selection of a window that was shown already', () => {
    const { selection, startChatWithAttachment } = setup(() => 'Fallback text')

    selection.apply(
      activation({ mode: START_MODES.EDITOR, selectedText: null })
    )
    expect(
      selection.apply(activation({ activationId: 2, selectedText: null }))
    ).toBe(true)
    expect(startChatWithAttachment).toHaveBeenCalledWith('Fallback text')
  })

  it('leaves the editor selection of a hidden window alone', () => {
    const { selection, startChatWithAttachment } = setup(() => 'Stale text')

    selection.apply(
      activation({ mode: START_MODES.EDITOR, isWindowShown: false })
    )
    expect(
      selection.apply(activation({ activationId: 2, selectedText: null }))
    ).toBe(false)
    // the selection captured elsewhere arrives later and is taken
    expect(selection.apply(activation({ activationId: 2 }))).toBe(true)
    expect(startChatWithAttachment.mock.calls).toEqual([['Selected for chat']])
  })

  it('ignores other modes, a hidden window and a blank selection', () => {
    const { selection, startChatWithAttachment } = setup()

    selection.apply(activation({ mode: START_MODES.EDITOR }))
    selection.apply(activation({ activationId: 2, isWindowShown: false }))
    selection.apply(activation({ activationId: 3, selectedText: '  \n' }))

    expect(startChatWithAttachment).not.toHaveBeenCalled()
  })

  it('prefers external selection arriving after editor fallback', () => {
    const { selection, startChatWithAttachment } = setup(() => 'Fallback text')

    selection.apply(
      activation({ mode: START_MODES.EDITOR, selectedText: null })
    )
    expect(
      selection.apply(activation({ activationId: 2, selectedText: null }))
    ).toBe(true)
    expect(
      selection.apply(
        activation({ activationId: 2, selectedText: 'External text' })
      )
    ).toBe(true)
    expect(startChatWithAttachment.mock.calls).toEqual([
      ['Fallback text'],
      ['External text'],
    ])
  })
})
