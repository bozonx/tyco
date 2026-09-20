import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { PasteMode } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import type { BubbleMenuRequest, ContextMenuRequest } from './context-menu'
import { wordAt } from './context-menu'
import { createEditorExtensions } from './create-editor-state'

interface Harness {
  view: EditorView
  contextMenus: ContextMenuRequest[]
  bubbleMenus: (BubbleMenuRequest | null)[]
}

const mount = (doc: string, mode: PasteMode = 'markdown'): Harness => {
  const contextMenus: ContextMenuRequest[] = []
  const bubbleMenus: (BubbleMenuRequest | null)[] = []
  const parent = document.createElement('div')

  document.body.appendChild(parent)

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: createEditorExtensions({
        paste: { getMode: () => mode },
        onContextMenu: (request) => contextMenus.push(request),
        onSelectionMenu: (request) => bubbleMenus.push(request),
      }),
    }),
  })

  return { view, contextMenus, bubbleMenus }
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

describe('bubble menu', () => {
  it('reports a non-empty selection and its removal', async () => {
    const { view, bubbleMenus } = mount('hello world')

    view.dispatch({ selection: { anchor: 0, head: 5 } })

    // the menu is debounced and its geometry is read in a measure pass
    await vi.waitFor(() =>
      expect(bubbleMenus[bubbleMenus.length - 1]?.selectedText).toBe('hello')
    )

    view.dispatch({ selection: { anchor: 5, head: 5 } })

    expect(bubbleMenus[bubbleMenus.length - 1]).toBeNull()

    view.destroy()
  })

  it('stays quiet while the selection is still being dragged', async () => {
    const { view, bubbleMenus } = mount('hello world')

    view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    view.dispatch({ selection: { anchor: 0, head: 3 } })
    view.dispatch({ selection: { anchor: 0, head: 5 } })

    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(bubbleMenus).toHaveLength(0)

    window.dispatchEvent(new MouseEvent('mouseup'))

    await vi.waitFor(() =>
      expect(bubbleMenus[bubbleMenus.length - 1]?.selectedText).toBe('hello')
    )

    view.destroy()
  })

  it('anchors the menu to the selected line so it can be placed above it', async () => {
    const { view, bubbleMenus } = mount('hello world')

    view.dispatch({ selection: { anchor: 0, head: 5 } })

    await vi.waitFor(() => expect(bubbleMenus.length).toBeGreaterThan(0))

    const request = bubbleMenus[bubbleMenus.length - 1]

    expect(request?.bottom).toBeGreaterThanOrEqual(request!.y)

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

  it('inserts plain text when the mode is plain', () => {
    const { view } = mount('', 'plain')

    view.contentDOM.dispatchEvent(
      pasteEvent({ 'text/html': '<h1>Title</h1>', 'text/plain': 'Title' })
    )

    expect(view.state.doc.toString()).toBe('Title')

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
