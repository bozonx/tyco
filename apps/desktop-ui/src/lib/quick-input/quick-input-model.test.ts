import { describe, expect, it } from 'vitest'

import { createQuickInputModel } from './quick-input-model'

describe('quick input model', () => {
  it('keeps unfinished text across repeated activations', () => {
    const model = createQuickInputModel()
    model.setValue('draft')
    expect(model.startSession()).toBe(true)
    expect(model.value.value).toBe('draft')
    expect(model.startSession()).toBe(true)
    expect(model.value.value).toBe('draft')
  })

  it('starts empty after the text left the app', () => {
    const model = createQuickInputModel()
    model.setValue('sent')
    model.finish()
    expect(model.startSession()).toBe(false)
    expect(model.value.value).toBe('')
    model.setValue('next')
    expect(model.startSession()).toBe(true)
    expect(model.value.value).toBe('next')
  })

  it('keeps no copy of cleared or discarded text', () => {
    const model = createQuickInputModel()
    model.setValue('kept')
    model.clear()
    model.setValue('cancelled')
    model.discard()
    expect(model.value.value).toBe('')
    expect(model).not.toHaveProperty('recallText')
    expect(model.startSession()).toBe(false)
    expect(model.value.value).toBe('')
  })

  it('counts focus requests', () => {
    const model = createQuickInputModel()
    model.requestFocus()
    model.requestFocusAndSelectAll()
    expect(model.focusRequestCount.value).toBe(1)
    expect(model.selectAllRequestCount.value).toBe(1)
  })
})
