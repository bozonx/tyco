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

  it('preserves a document when a foreign result has no matching source', async () => {
    const { store } = createStore()

    store.setValue('Intro. hello world')
    store.setSelection('Intro.', 0, 6)

    expect(store.applyResult('Texto externo', 'external text')).toBe(false)

    expect(store.value.value).toBe('Intro. hello world')
    expect(store.selectedText.value).toBe('Intro.')
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
      else store.applyResult('new', 'old document')
      expect(store.selectedText.value).toBe('')
      expect(store.selectionStart.value).toBe(0)
      expect(store.selectionEnd.value).toBe(0)
      expect(store.actionText()).toBe('new')
    }
  )
})

describe('conditional editor edits', () => {
  it('applies a current selection snapshot and keeps the surrounding document', () => {
    const { store } = createStore()
    store.setValue('before selected after')
    store.setSelection('selected', 7, 15)
    expect(
      store.applySnapshotEdit(store.getSnapshot(), 'new', 'selection')
    ).toBe(true)
    expect(store.value.value).toBe('before new after')
  })

  it.each(['document', 'selection', 'undo'] as const)(
    'rejects snapshots after %s changes',
    (change) => {
      const { store } = createStore()
      store.setValue('old old')
      store.setSelection('old', 0, 3)
      const snapshot = store.getSnapshot()
      if (change === 'selection') store.setSelection('old', 4, 7)
      else {
        store.setValue('edited')
        if (change === 'undo') store.setValue('old old')
      }
      const current = store.getSnapshot()
      expect(store.applySnapshotEdit(snapshot, 'new', 'selection')).toBe(false)
      expect(store.getSnapshot()).toEqual(current)
    }
  )

  it('clears a current document snapshot and drops its selection', () => {
    const { store } = createStore()
    store.setValue('saved text')
    expect(store.applySnapshotEdit(store.getSnapshot(), '', 'document')).toBe(
      true
    )
    expect(store.value.value).toBe('')
    expect(store.selectedText.value).toBe('')
  })

  it('rejects an AI result after a captured selection moves to identical text', () => {
    const { store } = createStore()
    store.setValue('old old')
    store.setSelection('old', 0, 3)
    store.captureResultSource('old')
    store.setSelection('old', 4, 7)
    expect(store.applyResult('new', 'old')).toBe(false)
    expect(store.value.value).toBe('old old')
  })

  it('does not replace the document after the original selection is cleared', () => {
    const { store } = createStore()
    store.setValue('before old after')
    store.setSelection('old', 7, 10)
    store.captureResultSource('old')
    store.setSelection('', 0, 0)
    expect(store.applyResult('new', 'old')).toBe(false)
    expect(store.value.value).toBe('before old after')
  })

  it('retains edits made while a whole document AI result was pending', () => {
    const { store } = createStore()
    store.setValue('original')
    store.captureResultSource('original')
    store.setValue('original plus new text')
    expect(store.applyResult('replacement', 'original')).toBe(false)
    expect(store.value.value).toBe('original plus new text')
  })

  it('accepts a foreign result into an empty editor', () => {
    const { store } = createStore()
    expect(store.applyResult('external result', 'external source')).toBe(true)
    expect(store.value.value).toBe('external result')
  })
})
