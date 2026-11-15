import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { afterEach, expect, it, vi } from 'vitest'

import { createEditorState } from './create-editor-state'
import { applyStoreEdit } from './editor-sync'

let view: EditorView | undefined
afterEach(() => {
  view?.destroy()
  view = undefined
  vi.useRealTimers()
})

function fixture() {
  const parent = document.createElement('div')
  document.body.append(parent)
  view = new EditorView({
    parent,
    state: createEditorState({ doc: 'Before text.' }),
  })
  return view
}

it('highlights only the applied change, expires without moving selection and keeps one undo step', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const editor = fixture()
  applyStoreEdit(editor, {
    value: 'Before corrected text.',
    source: 'ai',
    selectionStart: 7,
    selectionEnd: 7,
  })
  expect(editor.dom.querySelector('.cm-change-feedback')?.textContent).toBe(
    'corrected '
  )
  const selection = editor.state.selection
  vi.advanceTimersByTime(650)
  expect(editor.dom.querySelector('.cm-change-feedback')).toBeNull()
  expect(editor.state.selection.eq(selection)).toBe(true)
  expect(undo(editor)).toBe(true)
  expect(editor.state.doc.toString()).toBe('Before text.')
})

it('clears obsolete feedback on typing and restarts the deadline for a new result', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const editor = fixture()
  applyStoreEdit(editor, { value: 'First result.', source: 'ai' })
  vi.advanceTimersByTime(400)
  applyStoreEdit(editor, { value: 'Second result.', source: 'ai' })
  vi.advanceTimersByTime(300)
  expect(editor.dom.querySelector('.cm-change-feedback')).not.toBeNull()
  editor.dispatch({ changes: { from: 0, insert: 'A' } })
  expect(editor.dom.querySelector('.cm-change-feedback')).toBeNull()
})

it('does not highlight ordinary synchronization or a no-op result', () => {
  const editor = fixture()
  applyStoreEdit(editor, { value: 'Plain edit.', source: 'plain' })
  expect(editor.dom.querySelector('.cm-change-feedback')).toBeNull()
  applyStoreEdit(editor, { value: 'Plain edit.', source: 'ai' })
  expect(editor.dom.querySelector('.cm-change-feedback')).toBeNull()
})
