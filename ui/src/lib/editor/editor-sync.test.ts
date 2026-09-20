import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { createEditorState } from './createEditorState'
import {
  applyStoreSelection,
  applyStoreValue,
  computeMinimalChange,
  selectAll,
  setPlaceholder,
} from './editorSync'

interface StoreSpy {
  value: string
  selectedText: string
  start: number
  end: number
  docChanges: number
  selectionChanges: number
}

const mountView = (doc = ''): { view: EditorView; spy: StoreSpy } => {
  const spy: StoreSpy = {
    value: doc,
    selectedText: '',
    start: 0,
    end: 0,
    docChanges: 0,
    selectionChanges: 0,
  }

  const parent = document.createElement('div')

  document.body.appendChild(parent)

  const view = new EditorView({
    parent,
    state: createEditorState({
      doc,
      placeholder: 'holder',
      onDocChange: (value) => {
        spy.value = value
        spy.docChanges++
      },
      onSelectionChange: (text, start, end) => {
        spy.selectedText = text
        spy.start = start
        spy.end = end
        spy.selectionChanges++
      },
    }),
  })

  return { view, spy }
}

describe('computeMinimalChange', () => {
  it('returns null for equal texts', () => {
    expect(computeMinimalChange('same', 'same')).toBeNull()
  })

  it('reports an insertion in the middle', () => {
    expect(computeMinimalChange('ac', 'abc')).toEqual({
      from: 1,
      to: 1,
      insert: 'b',
    })
  })

  it('reports a deletion in the middle', () => {
    expect(computeMinimalChange('abc', 'ac')).toEqual({
      from: 1,
      to: 2,
      insert: '',
    })
  })

  it('reports a replacement keeping the common prefix and suffix', () => {
    expect(computeMinimalChange('hello world', 'hello brave world')).toEqual({
      from: 6,
      to: 6,
      insert: 'brave ',
    })
  })

  it('does not overlap prefix and suffix on repeated characters', () => {
    const change = computeMinimalChange('aaa', 'aa')

    expect(change).not.toBeNull()
    expect(change!.from).toBeLessThanOrEqual(change!.to)
    expect(
      'aaa'.slice(0, change!.from) + change!.insert + 'aaa'.slice(change!.to)
    ).toBe('aa')
  })

  it('handles an empty target', () => {
    expect(computeMinimalChange('abc', '')).toEqual({
      from: 0,
      to: 3,
      insert: '',
    })
  })
})

describe('applyStoreValue', () => {
  it('writes the value into the document', () => {
    const { view } = mountView('one')

    expect(applyStoreValue(view, 'one two')).toBe(true)
    expect(view.state.doc.toString()).toBe('one two')

    view.destroy()
  })

  it('does nothing when the document already matches', () => {
    const { view } = mountView('same')

    expect(applyStoreValue(view, 'same')).toBe(false)

    view.destroy()
  })

  it('does not echo store edits back to the store', () => {
    const { view, spy } = mountView('one')

    applyStoreValue(view, 'one two')

    expect(spy.docChanges).toBe(0)
    expect(spy.selectionChanges).toBe(0)

    view.destroy()
  })

  it('goes through history, so a store edit can be undone', () => {
    const { view } = mountView('one')

    applyStoreValue(view, 'one two')
    expect(view.state.doc.toString()).toBe('one two')

    undo(view)
    expect(view.state.doc.toString()).toBe('one')

    view.destroy()
  })
})

describe('applyStoreSelection', () => {
  it('sets the selection range', () => {
    const { view } = mountView('hello world')

    expect(applyStoreSelection(view, 6, 11)).toBe(true)
    expect(view.state.selection.main.from).toBe(6)
    expect(view.state.selection.main.to).toBe(11)

    view.destroy()
  })

  it('clamps offsets to the document length', () => {
    const { view } = mountView('abc')

    applyStoreSelection(view, 0, 100)

    expect(view.state.selection.main.to).toBe(3)

    view.destroy()
  })

  it('does nothing when the selection already matches', () => {
    const { view } = mountView('hello')

    applyStoreSelection(view, 1, 3)

    expect(applyStoreSelection(view, 1, 3)).toBe(false)

    view.destroy()
  })

  it('does not echo back to the store', () => {
    const { view, spy } = mountView('hello world')

    applyStoreSelection(view, 0, 5)

    expect(spy.selectionChanges).toBe(0)

    view.destroy()
  })
})

describe('user edits', () => {
  it('reports the new document and caret to the store', () => {
    const { view, spy } = mountView('')

    view.dispatch(view.state.replaceSelection('typed'))

    expect(spy.value).toBe('typed')
    expect(spy.docChanges).toBe(1)
    expect(spy.start).toBe(5)
    expect(spy.end).toBe(5)
    expect(spy.selectedText).toBe('')

    view.destroy()
  })

  it('reports the selected text', () => {
    const { view, spy } = mountView('hello world')

    view.dispatch({ selection: { anchor: 6, head: 11 } })

    expect(spy.selectedText).toBe('world')
    expect(spy.start).toBe(6)
    expect(spy.end).toBe(11)

    view.destroy()
  })

  it('selectAll selects the whole document and reports it', () => {
    const { view, spy } = mountView('hello world')

    selectAll(view)

    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(11)
    expect(spy.selectedText).toBe('hello world')

    view.destroy()
  })
})

describe('setPlaceholder', () => {
  it('reconfigures without touching the document or the store', () => {
    const { view, spy } = mountView('text')

    setPlaceholder(view, 'другой текст')

    expect(view.state.doc.toString()).toBe('text')
    expect(spy.docChanges).toBe(0)
    expect(spy.selectionChanges).toBe(0)

    view.destroy()
  })
})
