import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { createEditorExtensions } from './create-editor-state'

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

const editorWith = (doc: string, from: number, to = from): EditorView => {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: createEditorExtensions(),
    }),
  })
  return view
}

/** Whether the editor handled the key; an unhandled Tab moves the focus */
const pressTab = (target: EditorView, shiftKey = false): boolean =>
  !target.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      keyCode: 9,
      shiftKey,
      bubbles: true,
      cancelable: true,
    })
  )

describe('Tab in the editor', () => {
  it('nests the list item under the caret and Shift+Tab takes it back', () => {
    const editor = editorWith('- a\n- b', 7)

    expect(pressTab(editor)).toBe(true)
    expect(editor.state.doc.toString()).toBe('- a\n    - b')

    expect(pressTab(editor, true)).toBe(true)
    expect(editor.state.doc.toString()).toBe('- a\n- b')
  })

  it('indents every selected line', () => {
    const editor = editorWith('one\ntwo', 0, 7)

    pressTab(editor)
    expect(editor.state.doc.toString()).toBe('    one\n    two')
  })

  it('inserts spaces at the caret outside lists', () => {
    const editor = editorWith('ab', 1)

    expect(pressTab(editor)).toBe(true)
    expect(editor.state.doc.toString()).toBe('a    b')
  })
})
