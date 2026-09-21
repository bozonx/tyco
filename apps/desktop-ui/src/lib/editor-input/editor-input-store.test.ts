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

  it('applies a result to the selection it was made from', () => {
    const historyApi = { saveMainInputTmp: vi.fn(), clearMainInputTmp: vi.fn() }
    const store = createEditorInputStoreModel(historyApi)

    store.setValue('Intro. hello world \nOutro.')
    store.setSelection(' hello world \n', 6, 20)

    store.applyResult('Hola mundo\n', 'hello world')

    expect(store.value.value).toBe('Intro. Hola mundo \nOutro.')
    expect(store.lastEditSource.value).toBe('ai')
  })

  it('replaces the whole document when there is no selection', () => {
    const historyApi = { saveMainInputTmp: vi.fn(), clearMainInputTmp: vi.fn() }
    const store = createEditorInputStoreModel(historyApi)

    store.setValue('hello world')

    store.applyResult('Hola mundo', 'hello world')

    expect(store.value.value).toBe('Hola mundo')
  })

  it('ignores a selection the result was not made from', () => {
    const historyApi = { saveMainInputTmp: vi.fn(), clearMainInputTmp: vi.fn() }
    const store = createEditorInputStoreModel(historyApi)

    store.setValue('Intro. hello world')
    store.setSelection('Intro.', 0, 6)

    store.applyResult('Texto externo', 'external text')

    expect(store.value.value).toBe('Texto externo')
  })

  it('clears text and notifies history clear', () => {
    const historyApi = { saveMainInputTmp: vi.fn(), clearMainInputTmp: vi.fn() }
    const store = createEditorInputStoreModel(historyApi)

    store.setValue('temporary text')
    store.clear()

    expect(store.value.value).toBe('')
    expect(historyApi.clearMainInputTmp).toHaveBeenCalled()
  })

  it('drops the selection on clear', () => {
    const historyApi = { saveMainInputTmp: vi.fn(), clearMainInputTmp: vi.fn() }
    const store = createEditorInputStoreModel(historyApi)

    store.setValue('temporary text')
    store.setSelection('temporary', 0, 9)
    store.clear()

    expect(store.selectedText.value).toBe('')
    expect(store.selectionStart.value).toBe(0)
    expect(store.selectionEnd.value).toBe(0)
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
