import { undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'

import type { ContextMenuRequest } from './context-menu'
import { wordAt } from './context-menu'
import { createEditorExtensions } from './create-editor-state'

interface Harness {
  view: EditorView
  contextMenus: ContextMenuRequest[]
}

const mount = (doc: string): Harness => {
  const contextMenus: ContextMenuRequest[] = []
  const parent = document.createElement('div')

  document.body.appendChild(parent)

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: createEditorExtensions({
        paste: true,
        onContextMenu: (request) => contextMenus.push(request),
      }),
    }),
  })

  return { view, contextMenus }
}

/** Событие вставки: jsdom не умеет создавать ClipboardEvent с данными */
const pasteEvent = (data: Record<string, string>): Event => {
  const event = new Event('paste', { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => data[type] ?? '' },
  })

  return event
}

describe('wordAt', () => {
  it('finds a latin word under the offset', () => {
    const state = EditorState.create({ doc: 'hello world' })

    expect(wordAt(state, 8)).toEqual({ from: 6, to: 11, text: 'world' })
  })

  it('finds a cyrillic word under the offset', () => {
    const state = EditorState.create({ doc: 'привет мир' })

    expect(wordAt(state, 8)).toEqual({ from: 7, to: 10, text: 'мир' })
  })

  it('returns null between words', () => {
    const state = EditorState.create({ doc: 'a   b' })

    expect(wordAt(state, 2)).toBeNull()
  })
})

describe('context menu', () => {
  it('suppresses the native menu and reports the word under the cursor', () => {
    const { view, contextMenus } = mount('hello world')
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })

    view.contentDOM.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(contextMenus).toHaveLength(1)
    expect(contextMenus[0].selectedText).toBe('')

    view.destroy()
  })
})

describe('paste', () => {
  it('converts HTML into markdown', () => {
    const { view } = mount('')

    view.contentDOM.dispatchEvent(
      pasteEvent({
        'text/html': '<h1>Title</h1><ul><li>one</li></ul>',
        'text/plain': 'Title one',
      })
    )

    expect(view.state.doc.toString()).toBe('# Title\n\n- one')

    view.destroy()
  })

  it('drops only the formatting on the first undo', () => {
    const { view } = mount('')

    view.contentDOM.dispatchEvent(
      pasteEvent({ 'text/html': '<h1>Title</h1>', 'text/plain': 'Title' })
    )

    expect(view.state.doc.toString()).toBe('# Title')

    undo(view)

    expect(view.state.doc.toString()).toBe('Title')

    undo(view)

    expect(view.state.doc.toString()).toBe('')

    view.destroy()
  })

  it('runs the plain paste command on Ctrl+Shift+V', () => {
    const parent = document.createElement('div')
    const onPastePlain = vi.fn()

    document.body.appendChild(parent)

    const view = new EditorView({
      parent,
      state: EditorState.create({
        extensions: createEditorExtensions({ paste: true, onPastePlain }),
      }),
    })
    const keydown = new KeyboardEvent('keydown', {
      key: 'V',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })

    // CodeMirror resolves a shifted letter by its key code, which jsdom omits
    Object.defineProperty(keydown, 'keyCode', { value: 86 })
    view.contentDOM.dispatchEvent(keydown)

    expect(onPastePlain).toHaveBeenCalledOnce()
    expect(keydown.defaultPrevented).toBe(true)

    view.destroy()
    parent.remove()
  })

  it('pastes code copied from a code editor as plain text', () => {
    const { view } = mount('')
    const plain = 'function f() {\n  return a_b /* c */\n}'

    view.contentDOM.dispatchEvent(
      pasteEvent({
        'text/html':
          '<meta charset="utf-8"><div style="font-family: monospace; white-space: pre;">' +
          '<div><span>function f() {</span></div>' +
          '<div><span>  return a_b /* c */</span></div>' +
          '<div><span>}</span></div></div>',
        'text/plain': plain,
      })
    )

    expect(view.state.doc.toString()).toBe(plain)

    view.destroy()
  })

  it('leaves a plain-text-only clipboard to CodeMirror', () => {
    const { view } = mount('')

    view.contentDOM.dispatchEvent(pasteEvent({ 'text/plain': 'just text' }))

    // вставку делает сам CodeMirror, наш обработчик в неё не вмешивается
    expect(view.state.doc.toString()).toBe('just text')

    view.destroy()
  })

  it('replaces the selection instead of appending', () => {
    const { view } = mount('keep this')

    view.dispatch({ selection: { anchor: 5, head: 9 } })
    view.contentDOM.dispatchEvent(
      pasteEvent({ 'text/html': '<p>that</p>', 'text/plain': 'that' })
    )

    expect(view.state.doc.toString()).toBe('keep that')

    view.destroy()
  })
})

describe('live Markdown paste settings', () => {
  it('reads current shared settings for each paste', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    let bullet = '*' as '*' | '+'
    const view = new EditorView({
      parent,
      state: EditorState.create({
        extensions: createEditorExtensions({
          paste: true,
          getMarkdownSettings: () => ({ bullet }),
        }),
      }),
    })
    try {
      const data = { 'text/html': '<ul><li>one</li></ul>', 'text/plain': 'one' }
      view.contentDOM.dispatchEvent(pasteEvent(data))
      expect(view.state.doc.toString()).toBe('* one')
      bullet = '+'
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
      view.contentDOM.dispatchEvent(pasteEvent(data))
      expect(view.state.doc.toString()).toBe('+ one')
    } finally {
      view.destroy()
      parent.remove()
    }
  })
})
