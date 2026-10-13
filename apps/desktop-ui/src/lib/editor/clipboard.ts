import type { EditorView } from '@codemirror/view'

import { htmlToMarkdown, isCodeEditorHtml } from './html-to-markdown'
import { insertFormattedText, insertPastedText } from './paste'

/** Whether there is text to copy. */
const hasSelection = (view: EditorView): boolean => {
  const { from, to } = view.state.selection.main

  return from !== to
}

const selectedText = (view: EditorView): string => {
  const { from, to } = view.state.selection.main

  return view.state.sliceDoc(from, to)
}

export const copySelection = async (view: EditorView): Promise<void> => {
  if (!hasSelection(view)) return

  await navigator.clipboard.writeText(selectedText(view))
}

export const cutSelection = async (view: EditorView): Promise<void> => {
  if (!hasSelection(view)) return
  const before = view.state
  const { from, to } = before.selection.main
  await navigator.clipboard.writeText(selectedText(view))
  assertClipboardTarget(view, before)

  view.dispatch({ changes: { from, to, insert: '' }, scrollIntoView: true })
  view.focus()
}

export class StaleClipboardError extends Error {}

/** Do not apply a delayed clipboard operation to a different document or range. */
const assertClipboardTarget = (
  view: EditorView,
  before: EditorView['state']
): void => {
  if (
    !view.dom.isConnected ||
    view.state.doc !== before.doc ||
    !view.state.selection.eq(before.selection)
  ) {
    throw new StaleClipboardError('Clipboard target changed')
  }
}

/** Read HTML for Markdown conversion when available, otherwise plain text. */
const readClipboard = async (): Promise<{ html: string; plain: string }> => {
  const read = navigator.clipboard.read?.bind(navigator.clipboard)

  if (read) {
    try {
      const items = await read()

      for (const item of items) {
        const plain = item.types.includes('text/plain')
          ? await (await item.getType('text/plain')).text()
          : ''

        if (item.types.includes('text/html')) {
          return { html: await (await item.getType('text/html')).text(), plain }
        }

        if (plain) return { html: '', plain }
      }
    } catch {
      // Reading arbitrary types may be denied; try plain text below.
    }
  }

  return { html: '', plain: await navigator.clipboard.readText() }
}

/** Menu paste uses the same Markdown conversion as the native paste event. */
export const pasteFromClipboard = async (
  view: EditorView,
  settings?: unknown
): Promise<void> => {
  const before = view.state
  const { html, plain } = await readClipboard()
  assertClipboardTarget(view, before)
  const markdown =
    html.trim() && !isCodeEditorHtml(html) ? htmlToMarkdown(html, settings) : ''

  if (markdown) {
    insertFormattedText(view, plain, markdown)
  } else if (plain) {
    insertPastedText(view, plain)
  } else {
    return
  }

  view.focus()
}

/** Paste as plain text only. */
export const pastePlainFromClipboard = async (
  view: EditorView
): Promise<void> => {
  const before = view.state
  const text = await navigator.clipboard.readText()
  assertClipboardTarget(view, before)

  if (!text) return

  insertPastedText(view, text)
  view.focus()
}
