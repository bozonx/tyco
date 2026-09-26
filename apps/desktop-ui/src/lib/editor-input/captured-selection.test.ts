import { START_MODES } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  createCapturedSelection,
  type SelectionActivation,
} from './captured-selection'

function setup() {
  const replaceValue = vi.fn()
  const focus = vi.fn()
  const selection = createCapturedSelection({ replaceValue, focus })

  return { selection, replaceValue, focus }
}

const activation = (
  overrides: Partial<SelectionActivation> = {}
): SelectionActivation => ({
  activationId: 1,
  mode: START_MODES.EDITOR,
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

    selection.apply(activation({ mode: START_MODES.CHAT }))
    selection.apply(activation({ activationId: 2, isWindowShown: false }))
    selection.apply(activation({ activationId: 3, selectedText: '  \n' }))

    expect(replaceValue).not.toHaveBeenCalled()
  })
})
