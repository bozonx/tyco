import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  copySelection,
  cutSelection,
  pasteFromClipboard,
  pastePlainFromClipboard,
  StaleClipboardError,
} from './clipboard'
import { createEditorState } from './create-editor-state'
import { undo } from '@codemirror/commands'

let view: EditorView
const mount = () => {
  view = new EditorView({
    parent: document.body,
    state: createEditorState({ doc: 'first second' }),
  })
  view.dispatch({ selection: { anchor: 0, head: 5 } })
  return view
}
afterEach(() => {
  view?.destroy()
  vi.unstubAllGlobals()
})
const delayedClipboard = (method: 'writeText' | 'readText') => {
  let finish!: (value: string) => void
  const operation = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      })
  )
  vi.stubGlobal('navigator', { clipboard: { [method]: operation } })
  return { operation, finish: () => finish('pasted') }
}

describe('asynchronous clipboard edits', () => {
  it('cuts the copied range and restores it in one undo step', async () => {
    mount()
    const { operation, finish } = delayedClipboard('writeText')
    const pending = cutSelection(view)
    finish()
    await pending
    expect(operation).toHaveBeenCalledWith('first')
    expect(view.state.doc.toString()).toBe(' second')
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('first second')
  })

  it.each(['selection', 'document', 'destroy'] as const)(
    'does not delete a different target after %s changes',
    async (change) => {
      mount()
      const { operation, finish } = delayedClipboard('writeText')
      const pending = cutSelection(view)
      if (change === 'selection')
        view.dispatch({ selection: { anchor: 6, head: 12 } })
      else if (change === 'document')
        view.dispatch({ changes: { from: 0, insert: 'new ' } })
      else view.destroy()
      const expected = view.state.doc.toString()
      finish()
      await expect(pending).rejects.toBeInstanceOf(StaleClipboardError)
      expect(operation).toHaveBeenCalledWith('first')
      expect(view.state.doc.toString()).toBe(expected)
    }
  )

  it.each([pasteFromClipboard, pastePlainFromClipboard])(
    'does not paste into a selection changed while reading the clipboard',
    async (paste) => {
      mount()
      const { finish } = delayedClipboard('readText')
      const pending = paste(view)
      view.dispatch({ selection: { anchor: 6, head: 12 } })
      finish()
      await expect(pending).rejects.toBeInstanceOf(StaleClipboardError)
      expect(view.state.doc.toString()).toBe('first second')
    }
  )

  it('keeps the document when writing the clipboard is denied', async () => {
    mount()
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    await expect(cutSelection(view)).rejects.toThrow('denied')
    expect(view.state.doc.toString()).toBe('first second')
  })

  it('copies the original selection even when selection changes before completion', async () => {
    mount()
    const { operation, finish } = delayedClipboard('writeText')
    const pending = copySelection(view)
    view.dispatch({ selection: { anchor: 6, head: 12 } })
    finish()
    await pending
    expect(operation).toHaveBeenCalledWith('first')
    expect(view.state.doc.toString()).toBe('first second')
  })
})
