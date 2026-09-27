import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export { replaceRange } from './editor-sync'

export interface WordRange {
  from: number
  to: number
  text: string
}

export interface MenuAnchor {
  x: number
  /** Top of the anchored text line */
  y: number
  /** Bottom of the same line: menus placed `below` open under it */
  bottom: number
}

export interface ContextMenuRequest extends MenuAnchor {
  /** Document offset under the cursor */
  pos: number
  /** The word under the cursor, if the cursor sits on one */
  word: WordRange | null
  /** Selected text at the moment the menu was invoked */
  selectedText: string
}

/**
 * The word at an offset. Uses the built-in `state.wordAt`, which relies on
 * CodeMirror's locale-independent character categorization, so Cyrillic and
 * Latin are handled the same way
 */
export const wordAt = (state: EditorState, pos: number): WordRange | null => {
  const range = state.wordAt(pos)

  if (!range) return null

  return {
    from: range.from,
    to: range.to,
    text: state.sliceDoc(range.from, range.to),
  }
}

export interface EditorMenusOptions {
  /** Right click inside the editor */
  onContextMenu?: (request: ContextMenuRequest) => void
}

/**
 * Screen coordinates of a document offset: the anchor point of a menu.
 *
 * If the position cannot be measured (the document is not laid out yet), falls
 * back to the editor corner — the menu has to open either way
 */
export const anchorAtPos = (view: EditorView, pos: number): MenuAnchor => {
  try {
    const coords = view.coordsAtPos(pos)

    if (coords) return { x: coords.left, y: coords.top, bottom: coords.bottom }
  } catch {
    // no measurable geometry
  }

  const rect = view.dom.getBoundingClientRect()

  return { x: rect.left, y: rect.top, bottom: rect.top }
}

/** Document offset under a screen point; null when it cannot be measured */
const posAtPoint = (view: EditorView, x: number, y: number): number | null => {
  try {
    return view.posAtCoords({ x, y })
  } catch {
    return null
  }
}

/**
 * Context menu on right click.
 *
 * The native menu is always suppressed: inside the Tauri webview it is useless
 * anyway, and correction suggestions come from our own dictionary
 */
export const editorMenusExtension = (
  options: EditorMenusOptions = {}
): Extension => [
  EditorView.domEventHandlers({
    contextmenu: (event, view) => {
      event.preventDefault()

      if (!options.onContextMenu) return true

      const pos =
        posAtPoint(view, event.clientX, event.clientY) ??
        view.state.selection.main.head
      const { from, to } = view.state.selection.main

      options.onContextMenu({
        x: event.clientX,
        y: event.clientY,
        bottom: event.clientY,
        pos,
        word: wordAt(view.state, pos),
        selectedText: from === to ? '' : view.state.sliceDoc(from, to),
      })

      return true
    },
  }),
]
