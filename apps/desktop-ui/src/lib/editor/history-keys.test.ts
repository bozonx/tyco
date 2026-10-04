import { isolateHistory } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { createEditorExtensions } from './create-editor-state'
import { isRedoEvent, isUndoEvent } from './history-keys'

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

const keyEvent = (
  options: Partial<KeyboardEventInit> & { key?: string; code?: string }
): KeyboardEvent =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options })

describe('isUndoEvent', () => {
  it('recognizes Ctrl+Z and Cmd+Z on English layout', () => {
    expect(isUndoEvent(keyEvent({ key: 'z', ctrlKey: true }))).toBe(true)
    expect(isUndoEvent(keyEvent({ key: 'z', metaKey: true }))).toBe(true)
    expect(isUndoEvent(keyEvent({ key: 'Z', ctrlKey: true }))).toBe(true)
  })

  it('recognizes Ctrl+Z on Russian layout', () => {
    expect(isUndoEvent(keyEvent({ key: 'я', ctrlKey: true }))).toBe(true)
    expect(isUndoEvent(keyEvent({ key: 'Я', ctrlKey: true }))).toBe(true)
    expect(isUndoEvent(keyEvent({ code: 'KeyZ', ctrlKey: true }))).toBe(true)
  })

  it('rejects events without Mod or with Shift/Alt', () => {
    expect(isUndoEvent(keyEvent({ key: 'z' }))).toBe(false)
    expect(
      isUndoEvent(keyEvent({ key: 'z', ctrlKey: true, shiftKey: true }))
    ).toBe(false)
    expect(
      isUndoEvent(keyEvent({ key: 'z', ctrlKey: true, altKey: true }))
    ).toBe(false)
    expect(
      isUndoEvent(keyEvent({ key: 'я', ctrlKey: true, shiftKey: true }))
    ).toBe(false)
  })
})

describe('isRedoEvent', () => {
  it('recognizes Ctrl+Shift+Z and Cmd+Shift+Z on English layout', () => {
    expect(
      isRedoEvent(keyEvent({ key: 'z', ctrlKey: true, shiftKey: true }))
    ).toBe(true)
    expect(
      isRedoEvent(keyEvent({ key: 'Z', ctrlKey: true, shiftKey: true }))
    ).toBe(true)
    expect(
      isRedoEvent(keyEvent({ key: 'z', metaKey: true, shiftKey: true }))
    ).toBe(true)
  })

  it('recognizes Ctrl+Y on English layout', () => {
    expect(isRedoEvent(keyEvent({ key: 'y', ctrlKey: true }))).toBe(true)
    expect(isRedoEvent(keyEvent({ key: 'Y', ctrlKey: true }))).toBe(true)
    expect(isRedoEvent(keyEvent({ code: 'KeyY', ctrlKey: true }))).toBe(true)
  })

  it('recognizes Redo on Russian layout', () => {
    // Ctrl+Shift+я
    expect(
      isRedoEvent(keyEvent({ key: 'я', ctrlKey: true, shiftKey: true }))
    ).toBe(true)
    expect(
      isRedoEvent(keyEvent({ key: 'Я', ctrlKey: true, shiftKey: true }))
    ).toBe(true)
    expect(
      isRedoEvent(keyEvent({ code: 'KeyZ', ctrlKey: true, shiftKey: true }))
    ).toBe(true)

    // Ctrl+н
    expect(isRedoEvent(keyEvent({ key: 'н', ctrlKey: true }))).toBe(true)
    expect(isRedoEvent(keyEvent({ key: 'Н', ctrlKey: true }))).toBe(true)
    expect(isRedoEvent(keyEvent({ code: 'KeyY', ctrlKey: true }))).toBe(true)
  })

  it('rejects plain typing and Alt shortcuts', () => {
    expect(isRedoEvent(keyEvent({ key: 'y' }))).toBe(false)
    expect(isRedoEvent(keyEvent({ key: 'y', altKey: true }))).toBe(false)
    expect(isRedoEvent(keyEvent({ key: 'z', ctrlKey: true }))).toBe(false)
  })
})

describe('historyKeysExtension integration', () => {
  it('performs undo and redo with Russian keyboard events', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '',
        extensions: createEditorExtensions(),
      }),
    })

    // step 1: type first word
    view.dispatch({
      changes: { from: 0, insert: 'first' },
      annotations: isolateHistory.of('full'),
    })
    expect(view.state.doc.toString()).toBe('first')

    // step 2: type second word
    view.dispatch({
      changes: { from: 5, insert: ' second' },
      annotations: isolateHistory.of('full'),
    })
    expect(view.state.doc.toString()).toBe('first second')

    // undo via Russian Ctrl+я
    const undoEvent = keyEvent({ key: 'я', code: 'KeyZ', ctrlKey: true })
    view.contentDOM.dispatchEvent(undoEvent)
    expect(view.state.doc.toString()).toBe('first')
    expect(undoEvent.defaultPrevented).toBe(true)

    // redo via Russian Ctrl+н
    const redoYEvent = keyEvent({ key: 'н', code: 'KeyY', ctrlKey: true })
    view.contentDOM.dispatchEvent(redoYEvent)
    expect(view.state.doc.toString()).toBe('first second')
    expect(redoYEvent.defaultPrevented).toBe(true)

    // undo again with fresh event
    const undoEvent2 = keyEvent({ key: 'я', code: 'KeyZ', ctrlKey: true })
    view.contentDOM.dispatchEvent(undoEvent2)
    expect(view.state.doc.toString()).toBe('first')
    expect(undoEvent2.defaultPrevented).toBe(true)

    // redo via Russian Ctrl+Shift+я
    const redoShiftZEvent = keyEvent({
      key: 'Я',
      code: 'KeyZ',
      ctrlKey: true,
      shiftKey: true,
    })
    view.contentDOM.dispatchEvent(redoShiftZEvent)
    expect(view.state.doc.toString()).toBe('first second')
    expect(redoShiftZEvent.defaultPrevented).toBe(true)

    view.destroy()
  })
})
