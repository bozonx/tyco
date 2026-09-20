import { describe, expect, it, vi } from 'vitest'

import { createEditorInputStoreModel } from './editor-input-store'

describe('createEditorInputStoreModel', () => {
  it('updates text and calls history save', () => {
    const historyApi = { saveMainInputTmp: vi.fn(), clearMainInputTmp: vi.fn() }
    const store = createEditorInputStoreModel(historyApi)

    store.setValue('Hello world', 'plain')

    expect(store.value.value).toBe('Hello world')
    expect(store.lastEditSource.value).toBe('plain')
    expect(historyApi.saveMainInputTmp).toHaveBeenCalledWith('Hello world')
  })

  it('replaces selection accurately and updates selection range', () => {
    const historyApi = { saveMainInputTmp: vi.fn(), clearMainInputTmp: vi.fn() }
    const store = createEditorInputStoreModel(historyApi)

    store.setValue('Hello foo world')
    store.setSelection('foo', 6, 9)

    store.replaceSelection('beautiful', 'ai')

    expect(store.value.value).toBe('Hello beautiful world')
    expect(store.selectedText.value).toBe('beautiful')
    expect(store.selectionStart.value).toBe(6)
    expect(store.selectionEnd.value).toBe(15)
    expect(store.lastEditSource.value).toBe('ai')
  })

  it('clears text and notifies history clear', () => {
    const historyApi = { saveMainInputTmp: vi.fn(), clearMainInputTmp: vi.fn() }
    const store = createEditorInputStoreModel(historyApi)

    store.setValue('temporary text')
    store.clear()

    expect(store.value.value).toBe('')
    expect(historyApi.clearMainInputTmp).toHaveBeenCalled()
  })

  it('increments focus and selectAll counters', () => {
    const historyApi = { saveMainInputTmp: vi.fn(), clearMainInputTmp: vi.fn() }
    const store = createEditorInputStoreModel(historyApi)

    expect(store.focusCount.value).toBe(0)
    store.focus()
    expect(store.focusCount.value).toBe(1)

    expect(store.selectAllCount.value).toBe(0)
    store.selectAll()
    expect(store.selectAllCount.value).toBe(1)
  })
})
