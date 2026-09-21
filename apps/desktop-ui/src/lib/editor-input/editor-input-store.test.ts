import { describe, expect, it, vi } from 'vitest'

import { createEditorInputStoreModel } from './editor-input-store'

function createStore() {
  let counter = 0
  const saveDraft = vi.fn(
    async (_text: string, _replaceId?: string) => `draft-${++counter}`
  )
  const store = createEditorInputStoreModel({ saveDraft })

  return { store, saveDraft }
}

describe('createEditorInputStoreModel', () => {
  it('updates text without touching the history', () => {
    const { store, saveDraft } = createStore()

    store.setValue('Hello world', 'plain')

    expect(store.value.value).toBe('Hello world')
    expect(store.lastEditSource.value).toBe('plain')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('replaces selection accurately and updates selection range', () => {
    const { store } = createStore()

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
    const { store, saveDraft } = createStore()

    store.setValue('Intro. hello world \nOutro.')
    store.setSelection(' hello world \n', 6, 20)

    store.applyResult('Hola mundo\n', 'hello world')

    expect(store.value.value).toBe('Intro. Hola mundo \nOutro.')
    expect(store.lastEditSource.value).toBe('ai')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('replaces the whole document when there is no selection', () => {
    const { store, saveDraft } = createStore()

    store.setValue('hello world')

    store.applyResult('Hola mundo', 'hello world')

    expect(store.value.value).toBe('Hola mundo')
    // the text was the source of the operation, stored as such already
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('keeps the text a foreign result replaces', async () => {
    const { store, saveDraft } = createStore()

    store.setValue('Intro. hello world')
    store.setSelection('Intro.', 0, 6)

    store.applyResult('Texto externo', 'external text')

    expect(store.value.value).toBe('Texto externo')
    await vi.waitFor(() =>
      expect(saveDraft).toHaveBeenCalledWith('Intro. hello world', undefined)
    )
  })

  it('keeps the text a value from elsewhere replaces', async () => {
    const { store, saveDraft } = createStore()

    store.setValue('unsent text')
    store.replaceValue('from history')

    expect(store.value.value).toBe('from history')
    await vi.waitFor(() =>
      expect(saveDraft).toHaveBeenCalledWith('unsent text', undefined)
    )
  })

  it('does not store an empty or unchanged text on replace', async () => {
    const { store, saveDraft } = createStore()

    store.replaceValue('first')
    store.replaceValue(' first ')
    await Promise.resolve()

    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('keeps the cleared text', async () => {
    const { store, saveDraft } = createStore()

    store.setValue('temporary text')
    store.clear()

    expect(store.value.value).toBe('')
    await vi.waitFor(() =>
      expect(saveDraft).toHaveBeenCalledWith('temporary text', undefined)
    )
  })

  it('updates one draft while the session lasts and starts anew after a clear', async () => {
    const { store, saveDraft } = createStore()

    store.setValue('hello')
    await store.snapshotDraft()
    store.setValue('hello world')
    await store.snapshotDraft()
    store.clear()
    store.setValue('next')
    await store.snapshotDraft()

    expect(saveDraft.mock.calls).toEqual([
      ['hello', undefined],
      ['hello world', 'draft-1'],
      ['next', undefined],
    ])
  })

  it('drops the selection on clear', () => {
    const { store } = createStore()

    store.setValue('temporary text')
    store.setSelection('temporary', 0, 9)
    store.clear()

    expect(store.selectedText.value).toBe('')
    expect(store.selectionStart.value).toBe(0)
    expect(store.selectionEnd.value).toBe(0)
  })

  it('increments focus and selectAll counters', () => {
    const { store } = createStore()

    expect(store.focusCount.value).toBe(0)
    store.focus()
    expect(store.focusCount.value).toBe(1)

    expect(store.selectAllCount.value).toBe(0)
    store.selectAll()
    expect(store.selectAllCount.value).toBe(1)
  })
})
