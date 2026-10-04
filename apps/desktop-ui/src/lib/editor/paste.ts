import { Transaction } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

import { EDIT_USER_EVENT } from './edit-source'
import { htmlToMarkdown } from './html-to-markdown'

/**
 * How many milliseconds after Ctrl+Shift+V the next paste is treated as plain
 * text. The clipboard cannot be read directly in the key handler, so we record
 * the intent and wait for the native `paste` event.
 */
const PLAIN_PASTE_WINDOW_MS = 500

/** Insert text into current selection as a regular paste */
export const insertPastedText = (view: EditorView, text: string): void => {
  view.dispatch({
    ...view.state.replaceSelection(text),
    annotations: Transaction.userEvent.of(EDIT_USER_EVENT.paste),
    scrollIntoView: true,
  })
}

/**
 * Paste formatted text in two undo steps: the plain text first, then its
 * Markdown in place of it. A single Ctrl+Z drops only the formatting, so nobody
 * has to choose how to paste in advance.
 */
export const insertFormattedText = (
  view: EditorView,
  plain: string,
  markdown: string
): void => {
  if (!plain || plain === markdown) {
    insertPastedText(view, markdown)

    return
  }

  const from = view.state.selection.main.from

  insertPastedText(view, plain)

  // the cursor stands right after the inserted text; its length in the
  // document may differ from `plain.length` because of line separators
  const to = view.state.selection.main.head

  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: { anchor: from + markdown.length },
    annotations: Transaction.userEvent.of(EDIT_USER_EVENT.paste),
    scrollIntoView: true,
  })
}

/**
 * Paste handling: if the clipboard has `text/html`, convert it to Markdown;
 * otherwise paste `text/plain` as is. Ctrl+Shift+V always pastes plain text.
 */
export const pasteExtension = (): Extension => {
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

        if (forcePlain) {
          if (!plain) return false

          event.preventDefault()
          insertPastedText(view, plain)

          return true
        }

        const markdown = htmlToMarkdown(html)

        if (!markdown) return false

        event.preventDefault()
        insertFormattedText(view, plain, markdown)

        return true
      },
    }),
  ]
}
