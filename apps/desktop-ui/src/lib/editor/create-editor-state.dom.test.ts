import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'

import { createEditorState } from './create-editor-state'
import { setMarkdownPreview } from './markdown-preview'

const press = (
  view: EditorView,
  init: KeyboardEventInit & { keyCode: number }
) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  // jsdom ignores keyCode in the init dictionary
  Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  view.contentDOM.dispatchEvent(event)
}

const mountEditor = (onToggleMarkup?: () => void): EditorView =>
  new EditorView({
    parent: document.body,
    state: createEditorState({ doc: 'text', onToggleMarkup }),
  })

describe('toggle markup shortcut', () => {
  it('calls onToggleMarkup on Ctrl+Shift+M', () => {
    const onToggle = vi.fn()
    const view = mountEditor(onToggle)

    press(view, {
      key: 'M',
      ctrlKey: true,
      shiftKey: true,
      keyCode: 77,
      code: 'KeyM',
    })

    expect(onToggle).toHaveBeenCalledTimes(1)
    view.destroy()
  })

  it('works on the Russian layout', () => {
    const onToggle = vi.fn()
    const view = mountEditor(onToggle)

    press(view, {
      key: 'Ь',
      ctrlKey: true,
      shiftKey: true,
      keyCode: 77,
      code: 'KeyM',
    })

    expect(onToggle).toHaveBeenCalledTimes(1)
    view.destroy()
  })

  it('ignores Ctrl+M without Shift', () => {
    const onToggle = vi.fn()
    const view = mountEditor(onToggle)

    press(view, { key: 'm', ctrlKey: true, keyCode: 77, code: 'KeyM' })

    expect(onToggle).not.toHaveBeenCalled()
    view.destroy()
  })
})

describe('select all shortcut', () => {
  it('selects all on English Ctrl+A', () => {
    const doc = Array.from(
      { length: 500 },
      (_, i) => `Line ${i}: formatted **bold** text`
    ).join('\n')
    const view = new EditorView({
      parent: document.body,
      state: createEditorState({ doc, markdownPreview: true }),
    })

    press(view, { key: 'a', code: 'KeyA', ctrlKey: true, keyCode: 65 })
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(doc.length)
    view.destroy()
  })

  it('selects all on Russian Ctrl+A (KeyA with Cyrillic ф)', () => {
    const doc = Array.from(
      { length: 500 },
      (_, i) => `Line ${i}: formatted **bold** text`
    ).join('\n')
    const view = new EditorView({
      parent: document.body,
      state: createEditorState({ doc, markdownPreview: true }),
    })

    press(view, { key: 'ф', code: 'KeyA', ctrlKey: true, keyCode: 0 })
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(doc.length)
    view.destroy()
  })

  it('refreshes native DOM selection endpoints when docView redraws with a non-empty selection', () => {
    const doc = 'First line\nSecond line `code`\nThird line'
    const view = new EditorView({
      parent: document.body,
      state: createEditorState({ doc, markdownPreview: false }),
    })
    view.focus()

    press(view, { key: 'a', code: 'KeyA', ctrlKey: true, keyCode: 65 })
    const sel = window.getSelection()
    expect(sel?.anchorNode).not.toBeNull()
    const anchorParent = sel!.anchorNode!.parentNode!
    const insertBeforeSpy = vi.spyOn(anchorParent, 'insertBefore')

    // Trigger a docView redraw while the whole document remains selected
    setMarkdownPreview(view, true)

    expect(insertBeforeSpy).toHaveBeenCalled()
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(doc.length)
    view.destroy()
  })
})

describe('open actions shortcut', () => {
  it('calls onOpenActions on Ctrl+Enter', () => {
    const onOpenActions = vi.fn()
    const view = new EditorView({
      parent: document.body,
      state: createEditorState({ doc: 'text', onOpenActions }),
    })

    press(view, { key: 'Enter', code: 'Enter', ctrlKey: true, keyCode: 13 })

    expect(onOpenActions).toHaveBeenCalledTimes(1)
    view.destroy()
  })
})
