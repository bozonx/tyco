import { Transaction } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { PasteMode } from '@tyco/shared'

import type { MenuAnchor } from './context-menu'
import { anchorAtPos } from './context-menu'
import { EDIT_USER_EVENT } from './edit-source'
import { htmlToMarkdown } from './html-to-markdown'

/**
 * How many milliseconds after Ctrl+Shift+V the next paste is treated as plain
 * text. The clipboard cannot be read directly in the key handler, so we record
 * the intent and wait for the native `paste` event.
 */
const PLAIN_PASTE_WINDOW_MS = 500

export interface PasteAskRequest extends MenuAnchor {
  /** What will be inserted in plain text mode */
  plain: string
  /** What will be inserted in formatted markdown mode */
  markdown: string
  /** Insert the selected option */
  apply: (text: string) => void
}

export interface PasteOptions {
  /** Paste mode from user settings */
  getMode: () => PasteMode
  /** Prompt user how to paste. If omitted, behaves as `markdown`. */
  onAsk?: (request: PasteAskRequest) => void
}

/** Insert text into current selection as a regular paste */
export const insertPastedText = (view: EditorView, text: string): void => {
  view.dispatch({
    ...view.state.replaceSelection(text),
    annotations: Transaction.userEvent.of(EDIT_USER_EVENT.paste),
    scrollIntoView: true,
  })
}

/**
 * Paste handling: if the clipboard has `text/html`, convert to Markdown;
 * otherwise paste `text/plain` as is. Ctrl+Shift+V always pastes plain text.
 */
export const pasteExtension = (options: PasteOptions): Extension => {
  let plainPasteRequested = false
  let plainPasteTimer: ReturnType<typeof setTimeout> | null = null

  // the flag has to expire on its own: if the webview swallowed Ctrl+Shift+V
  // and no paste followed, the next plain Ctrl+V must not be downgraded
  const forgetPlainRequest = (): void => {
    plainPasteRequested = false

    if (plainPasteTimer === null) return

    clearTimeout(plainPasteTimer)
    plainPasteTimer = null
  }

  const requestPlainPaste = (): void => {
    forgetPlainRequest()
    plainPasteRequested = true
    plainPasteTimer = setTimeout(forgetPlainRequest, PLAIN_PASTE_WINDOW_MS)
  }

  const consumePlainRequest = (): boolean => {
    const requested = plainPasteRequested

    forgetPlainRequest()

    return requested
  }

  return [
    keymap.of([
      {
        key: 'Mod-Shift-v',
        run: () => {
          requestPlainPaste()

          // do not intercept: native paste should still occur,
          // the handler below will notice the flag and paste plain text
          return false
        },
      },
    ]),
    EditorView.domEventHandlers({
      paste: (event, view) => {
        const data = event.clipboardData

        if (!data) return false

        const plain = data.getData('text/plain')
        const html = data.getData('text/html')
        const forcePlain = consumePlainRequest()

        // without HTML there is nothing to convert — let CodeMirror
        // handle the paste itself
        if (!html.trim()) return false

        const mode = options.getMode()

        if (forcePlain || mode === 'plain') {
          if (!plain) return false

          event.preventDefault()
          insertPastedText(view, plain)

          return true
        }

        const markdown = htmlToMarkdown(html)

        if (!markdown) return false

        event.preventDefault()

        if (mode === 'ask' && options.onAsk) {
          const anchor = anchorAtPos(view, view.state.selection.main.head)

          options.onAsk({
            ...anchor,
            plain,
            markdown,
            apply: (text: string) => insertPastedText(view, text),
          })

          return true
        }

        insertPastedText(view, markdown)

        return true
      },
    }),
  ]
}
