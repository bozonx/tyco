import type { EditorState, Extension } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { EditorView, ViewPlugin } from '@codemirror/view'

export { replaceRange } from './editor-sync'

/**
 * How long the selection has to stay still before the bubble menu shows up.
 * Without it the menu would follow every Shift+Arrow keystroke
 */
const BUBBLE_MENU_DELAY_MS = 120

export interface WordRange {
  from: number
  to: number
  text: string
}

export interface MenuAnchor {
  x: number
  /** Top of the anchored text line: the menu is placed above it */
  y: number
  /** Bottom of the same line: the fallback when there is no room above */
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

export interface BubbleMenuRequest extends MenuAnchor {
  selectedText: string
  from: number
  to: number
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
  /**
   * The selection became non-empty and the bubble menu may be shown. Called
   * with `null` once the selection is dropped
   */
  onSelectionMenu?: (request: BubbleMenuRequest | null) => void
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
 * Bubble menu over a non-empty selection.
 *
 * The menu is deliberately not reported straight from the update: while the
 * pointer is down the user is still dragging the selection, and geometry must
 * not be read during an update cycle — hence `requestMeasure`
 */
const bubbleMenuPlugin = (options: EditorMenusOptions): Extension =>
  ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null
      dragging = false
      shown = false

      constructor(readonly view: EditorView) {
        this.view.dom.addEventListener('mousedown', this.onMouseDown)
        // the button may be released outside the editor
        window.addEventListener('mouseup', this.onMouseUp)
      }

      onMouseDown = (): void => {
        this.dragging = true
        this.cancel()
      }

      onMouseUp = (): void => {
        if (!this.dragging) return

        this.dragging = false

        if (!this.view.state.selection.main.empty) this.schedule()
      }

      update(update: ViewUpdate): void {
        if (!options.onSelectionMenu) return
        if (!update.selectionSet && !update.docChanged) return

        if (update.state.selection.main.empty) {
          this.cancel()

          if (this.shown) {
            this.shown = false
            options.onSelectionMenu(null)
          }

          return
        }

        this.schedule()
      }

      schedule(): void {
        this.cancel()

        if (this.dragging) return

        this.timer = setTimeout(() => {
          this.timer = null
          this.emit()
        }, BUBBLE_MENU_DELAY_MS)
      }

      emit(): void {
        const { from, to } = this.view.state.selection.main

        if (from === to) return

        this.view.requestMeasure({
          read: (view) => anchorAtPos(view, from),
          write: (anchor) => {
            const selection = this.view.state.selection.main

            if (selection.empty) return

            this.shown = true
            options.onSelectionMenu?.({
              ...anchor,
              from: selection.from,
              to: selection.to,
              selectedText: this.view.state.sliceDoc(
                selection.from,
                selection.to
              ),
            })
          },
        })
      }

      cancel(): void {
        if (this.timer === null) return

        clearTimeout(this.timer)
        this.timer = null
      }

      destroy(): void {
        this.cancel()
        this.view.dom.removeEventListener('mousedown', this.onMouseDown)
        window.removeEventListener('mouseup', this.onMouseUp)
      }
    }
  )

/**
 * Context menu on right click plus the bubble menu over a selection.
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
  bubbleMenuPlugin(options),
]
