import { describe, expect, it } from 'vitest'

import { createEditorInputStoreModel } from './editor-input-store'

function createStore() {
  return { store: createEditorInputStoreModel() }
}

describe('createEditorInputStoreModel', () => {
  it('updates text without touching the history', () => {
    const { store } = createStore()

    store.setValue('Hello world', 'plain')

    expect(store.value.value).toBe('Hello world')
    expect(store.lastEditSource.value).toBe('plain')
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
    const { store } = createStore()

    store.setValue('Intro. hello world \nOutro.')
    store.setSelection(' hello world \n', 6, 20)

    store.applyResult('Hola mundo\n', 'hello world')

    expect(store.value.value).toBe('Intro. Hola mundo \nOutro.')
    expect(store.lastEditSource.value).toBe('ai')
  })

  it('replaces the whole document when there is no selection', () => {
    const { store } = createStore()

    store.setValue('hello world')

    store.applyResult('Hola mundo', 'hello world')

    expect(store.value.value).toBe('Hola mundo')
    // the text was the source of the operation, stored as such already
  })

  it('replaces a document with a foreign result', async () => {
    const { store } = createStore()

    store.setValue('Intro. hello world')
    store.setSelection('Intro.', 0, 6)

    store.applyResult('Texto externo', 'external text')

    expect(store.value.value).toBe('Texto externo')
  })

  it('replaces a document with an external value', async () => {
    const { store } = createStore()

    store.setValue('unsent text')
    store.replaceValue('from history')

    expect(store.value.value).toBe('from history')
  })

  it('does not store an empty or unchanged text on replace', async () => {
    const { store } = createStore()

    store.replaceValue('first')
    store.replaceValue(' first ')
    await Promise.resolve()
  })

  it('clears temporary text', async () => {
    const { store } = createStore()

    store.setValue('temporary text')
    store.clear()

    expect(store.value.value).toBe('')
  })

  it('drops the selection on clear', () => {
    const { store } = createStore()

    store.setValue('temporary text')
    store.setSelection('temporary', 0, 9)
    store.clear()

    expect(store.selectedText.value).toBe('')
    expect(store.selectionStart.value).toBe(0)
    expect(store.selectionEnd.value).toBe(0)
    expect(store.lastEditSource.value).toBe('clear')
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

  it('acts on the selection, or on the whole text without one', () => {
    const { store } = createStore()

    store.setValue('Hello foo world')
    expect(store.hasSelection.value).toBe(false)
    expect(store.actionText()).toBe('Hello foo world')

    store.setSelection('foo', 6, 9)
    expect(store.hasSelection.value).toBe(true)
    expect(store.actionText()).toBe('foo')

    // whitespace only is not a selection worth acting on
    store.setSelection('  ', 5, 7)
    expect(store.hasSelection.value).toBe(false)
    expect(store.actionText()).toBe('Hello foo world')
  })
})

describe('whole document replacement', () => {
  it.each(['replaceValue', 'applyResult'] as const)(
    'drops a stale selection after %s',
    (operation) => {
      const { store } = createStore()
      store.setValue('old document')
      store.setSelection('old', 0, 3)
      if (operation === 'replaceValue') store.replaceValue('new')
      else store.applyResult('new', 'external source')
      expect(store.selectedText.value).toBe('')
      expect(store.selectionStart.value).toBe(0)
      expect(store.selectionEnd.value).toBe(0)
      expect(store.actionText()).toBe('new')
    }
  )
})
