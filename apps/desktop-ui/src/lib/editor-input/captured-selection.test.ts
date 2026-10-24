import { ActivationMode } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  createCapturedSelection,
  type SelectionActivation,
} from './captured-selection'

function setup() {
  const editor = { value: 'Earlier text' }
  const replaceValue = vi.fn((text: string) => {
    editor.value = text
  })
  const focus = vi.fn()
  const selection = createCapturedSelection({
    replaceValue,
    focus,
    getValue: () => editor.value,
  })

  return { selection, replaceValue, focus, editor }
}

const activation = (
  overrides: Partial<SelectionActivation> = {}
): SelectionActivation => ({
  activationId: 1,
  mode: ActivationMode.EDITOR,
  isWindowShown: true,
  selectedText: 'Selected elsewhere',
  ...overrides,
})

describe('createCapturedSelection', () => {
  it('puts the selection of an editor activation into the editor', () => {
    const { selection, replaceValue, focus } = setup()

    expect(selection.apply(activation())).toBe(true)

    expect(replaceValue).toHaveBeenCalledWith('Selected elsewhere')
    expect(focus).toHaveBeenCalledOnce()
  })

  it('waits for the selection captured after the activation', () => {
    const { selection, replaceValue } = setup()

    expect(selection.apply(activation({ selectedText: null }))).toBe(false)
    expect(selection.apply(activation())).toBe(true)

    expect(replaceValue).toHaveBeenCalledOnce()
  })

  it('takes the selection once per activation', () => {
    const { selection, replaceValue } = setup()

    selection.apply(activation())
    selection.apply(activation())
    selection.apply(activation({ activationId: 2, selectedText: 'Next' }))

    expect(replaceValue.mock.calls).toEqual([['Selected elsewhere'], ['Next']])
  })

  it('ignores other modes, a hidden window and a blank selection', () => {
    const { selection, replaceValue } = setup()

    selection.apply(activation({ mode: ActivationMode.CHAT }))
    selection.apply(activation({ activationId: 2, isWindowShown: false }))
    selection.apply(activation({ activationId: 3, selectedText: '  \n' }))

    expect(replaceValue).not.toHaveBeenCalled()
  })

  it('never overwrites what was typed while the selection was captured', () => {
    const { selection, replaceValue, editor } = setup()

    selection.apply(activation({ selectedText: null }))
    editor.value = 'Earlier text, and more'
    expect(selection.apply(activation())).toBe(false)
    // the next activation starts from the edited text
    expect(selection.apply(activation({ activationId: 2 }))).toBe(true)

    expect(replaceValue.mock.calls).toEqual([['Selected elsewhere']])
  })
})
