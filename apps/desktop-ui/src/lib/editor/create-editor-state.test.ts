import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'

import { createEditorState } from './create-editor-state'

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

    press(view, { key: 'M', ctrlKey: true, shiftKey: true, keyCode: 77 })

    expect(onToggle).toHaveBeenCalledTimes(1)
    view.destroy()
  })

  it('works on the Russian layout', () => {
    const onToggle = vi.fn()
    const view = mountEditor(onToggle)

    press(view, { key: 'Ь', ctrlKey: true, shiftKey: true, keyCode: 77 })

    expect(onToggle).toHaveBeenCalledTimes(1)
    view.destroy()
  })

  it('ignores Ctrl+M without Shift', () => {
    const onToggle = vi.fn()
    const view = mountEditor(onToggle)

    press(view, { key: 'm', ctrlKey: true, keyCode: 77 })

    expect(onToggle).not.toHaveBeenCalled()
    view.destroy()
  })
})
