import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { createEditorExtensions } from './create-editor-state'
import { editorShortcutFromEvent } from './editor-shortcuts'

let view: EditorView | undefined
afterEach(() => {
  view?.destroy()
  view = undefined
})
function editor(doc = 'Title', from = 0, to = from) {
  let shortcuts = { ...DEFAULT_USER_CONFIG.editor.shortcuts }
  const toggle = vi.fn()
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: createEditorExtensions({
        getEditorShortcuts: () => shortcuts,
        onToggleMarkup: toggle,
      }),
    }),
  })
  return {
    view,
    toggle,
    configure: (patch: Partial<typeof shortcuts>) => {
      shortcuts = { ...shortcuts, ...patch }
    },
  }
}
function press(
  view: EditorView,
  key: string,
  code: string,
  options: KeyboardEventInit = {}
) {
  return !view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code,
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      ...options,
    })
  )
}

describe('editor shortcuts', () => {
  it.each([1, 2, 3])('toggles heading %i and undoes it', (level) => {
    const { view } = editor('Title', 3)
    expect(press(view, String(level), `Digit${level}`)).toBe(true)
    expect(view.state.doc.toString()).toBe(`${'#'.repeat(level)} Title`)
    press(view, String(level), `Digit${level}`)
    expect(view.state.doc.toString()).toBe('Title')
    expect(undo(view)).toBe(true)
  })
  it('does not bind headings 4-6 by default', () => {
    const { view } = editor('Title', 3)
    expect(press(view, '4', 'Digit4')).toBe(false)
    expect(press(view, '5', 'Digit5')).toBe(false)
    expect(press(view, '6', 'Digit6')).toBe(false)
    expect(view.state.doc.toString()).toBe('Title')
  })
  it('turns heading into normal text with Ctrl+0', () => {
    const { view } = editor('# Title', 3)
    expect(press(view, '0', 'Digit0')).toBe(true)
    expect(view.state.doc.toString()).toBe('Title')
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('# Title')
  })
  it('toggles bulleted, numbered, checklist lists and quotes with default shortcuts', () => {
    const { view } = editor('Item', 2)
    expect(press(view, '8', 'Digit8', { shiftKey: true })).toBe(true)
    expect(view.state.doc.toString()).toBe('- Item')

    expect(press(view, '7', 'Digit7', { shiftKey: true })).toBe(true)
    expect(view.state.doc.toString()).toBe('1. Item')

    expect(press(view, '9', 'Digit9', { shiftKey: true })).toBe(true)
    expect(view.state.doc.toString()).toBe('- [ ] Item')

    expect(press(view, '.', 'Period', { shiftKey: true })).toBe(true)
    expect(view.state.doc.toString()).toBe('> Item')
  })
  it('keeps the caret after the inserted heading marker', () => {
    const { view } = editor('', 0)
    press(view, '3', 'Digit3')
    expect(view.state.selection.main.head).toBe(4)
    view.dispatch(view.state.replaceSelection('Title'))
    expect(view.state.doc.toString()).toBe('### Title')
    undo(view)
    expect(view.state.doc.toString()).toBe('### ')
    undo(view)
    expect(view.state.doc.toString()).toBe('')
  })
  it('changes the heading level and excludes a line at the selection end', () => {
    const { view } = editor('# One\nTwo\nThree', 0, 10)
    press(view, '2', 'Digit2')
    expect(view.state.doc.toString()).toBe('## One\n## Two\nThree')
  })
  it('uses current bindings immediately and releases the old binding', () => {
    const { view, configure } = editor('text', 0, 4)
    configure({ bold: 'Alt+B' })
    press(view, 'b', 'KeyB')
    expect(view.state.doc.toString()).toBe('text')
    press(view, 'и', 'KeyB', { ctrlKey: false, altKey: true })
    expect(view.state.doc.toString()).toBe('**text**')
    configure({ bold: '' })
    expect(press(view, 'b', 'KeyB', { ctrlKey: false, altKey: true })).toBe(
      false
    )
  })
  it('toggles empty inline marks back off', () => {
    const { view } = editor('', 0)
    press(view, 'и', 'KeyB')
    expect(view.state.doc.toString()).toBe('****')
    press(view, 'и', 'KeyB')
    expect(view.state.doc.toString()).toBe('')
  })
  it('does not insert Markdown into fenced code, including its opening fence', () => {
    const doc = '```js\nconst x = 1\n```'
    const { view } = editor(doc, 8)
    press(view, '1', 'Digit1')
    press(view, 'b', 'KeyB')
    expect(view.state.doc.toString()).toBe(doc)
    view.dispatch({ selection: { anchor: 0 } })
    press(view, '2', 'Digit2')
    expect(view.state.doc.toString()).toBe(doc)
  })
  it('supports reassignment of the display toggle', () => {
    const { view, toggle, configure } = editor()
    configure({ toggleMarkup: 'Alt+M' })
    press(view, 'M', 'KeyM', { shiftKey: true })
    expect(toggle).not.toHaveBeenCalled()
    press(view, 'm', 'KeyM', { ctrlKey: false, altKey: true })
    expect(toggle).toHaveBeenCalledOnce()
  })
  it('preserves Escape followed by Tab to leave the editor', () => {
    const { view } = editor('text')
    press(view, 'Escape', 'Escape', { ctrlKey: false, keyCode: 27 })
    expect(press(view, 'Tab', 'Tab', { ctrlKey: false, keyCode: 9 })).toBe(
      false
    )
    expect(view.state.doc.toString()).toBe('text')
  })
  it('records digits independently of Shift and preserves Latin layouts', () => {
    expect(
      editorShortcutFromEvent(
        new KeyboardEvent('keydown', {
          key: '&',
          code: 'Digit1',
          ctrlKey: true,
        })
      )
    ).toBe('Ctrl+1')
    expect(
      editorShortcutFromEvent(
        new KeyboardEvent('keydown', { key: 'z', code: 'KeyY', ctrlKey: true })
      )
    ).toBe('Ctrl+Z')
    expect(
      editorShortcutFromEvent(
        new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', shiftKey: true })
      )
    ).toBeNull()
  })
})
