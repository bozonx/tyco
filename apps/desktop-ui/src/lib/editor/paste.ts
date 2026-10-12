import { Transaction } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

import { EDIT_USER_EVENT } from './edit-source'
import { htmlToMarkdown, isCodeEditorHtml } from './html-to-markdown'

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
 * otherwise paste `text/plain` as is. HTML copied from a code editor is code,
 * not formatted text, so it is pasted as plain text too.
 *
 * Ctrl+Shift+V runs `onPastePlain`: WebKitGTK does not bind that shortcut to a
 * paste, so no `paste` event would follow it.
 */
export const pasteExtension = (
  getSettings: () => unknown = () => undefined,
  onPastePlain?: () => void
): Extension => [
  ...(onPastePlain
    ? [
        keymap.of([
          {
            key: 'Mod-Shift-v',
            run: () => {
              onPastePlain()

              return true
            },
          },
        ]),
      ]
    : []),
  EditorView.domEventHandlers({
    paste: (event, view) => {
      const data = event.clipboardData

      if (!data) return false

      const html = data.getData('text/html')

      // without HTML there is nothing to convert — let CodeMirror handle the
      // paste itself; it takes `text/plain`
      if (!html.trim() || isCodeEditorHtml(html)) return false

      const markdown = htmlToMarkdown(html, getSettings())

      if (!markdown) return false

      event.preventDefault()
      insertFormattedText(view, data.getData('text/plain'), markdown)

      return true
    },
  }),
]
