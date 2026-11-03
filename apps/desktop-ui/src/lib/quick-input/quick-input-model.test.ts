import { describe, expect, it } from 'vitest'

import { createQuickInputModel } from './quick-input-model'

function setup() {
  return { model: createQuickInputModel() }
}

describe('writer input model', () => {
  it('keeps unfinished text across repeated activations', () => {
    const { model } = setup()
    model.setValue('draft')
    model.markDismissed()
    expect(model.startSession()).toBe(true)
    expect(model.value.value).toBe('draft')
    model.markDismissed()
    expect(model.startSession()).toBe(true)
    expect(model.value.value).toBe('draft')
  })

  it('keeps cleared and discarded inputs recallable in memory', () => {
    const { model } = setup()
    model.setValue('kept')
    model.clear()
    expect(model.recallText.value).toBe('kept')
    model.setValue('cancelled')
    model.discard()
    expect(model.recallText.value).toBe('cancelled')
    expect(model.value.value).toBe('')
  })

  it('keeps input text and remembers submitted text', async () => {
    const { model } = setup()
    model.setValue('draft')
    expect(model.value.value).toBe('draft')
    model.rememberSubmitted('submitted')
    expect(model.recallText.value).toBe('submitted')
    model.requestFocus()
    model.requestFocusAndSelectAll()
    expect(model.focusRequestCount.value).toBe(1)
    expect(model.selectAllRequestCount.value).toBe(1)
  })
})
