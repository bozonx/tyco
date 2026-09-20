import type { EditorView } from '@codemirror/view'
import type { PasteMode } from '@shared'

import { htmlToMarkdown } from './htmlToMarkdown'
import { insertPastedText } from './paste'

/** Есть ли в документе что копировать */
export const hasSelection = (view: EditorView): boolean => {
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

  await navigator.clipboard.writeText(selectedText(view))

  const { from, to } = view.state.selection.main

  view.dispatch({
    changes: { from, to, insert: '' },
    scrollIntoView: true,
  })
  view.focus()
}

/**
 * Прочитать буфер обмена. Возвращает HTML, если он там есть — из него получится
 * Markdown; иначе только текст
 */
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
          return {
            html: await (await item.getType('text/html')).text(),
            plain,
          }
        }

        if (plain) return { html: '', plain }
      }
    } catch {
      // нет прав на чтение произвольных типов — падаем на readText ниже
    }
  }

  return { html: '', plain: await navigator.clipboard.readText() }
}

/** Вставка из пункта меню: тот же выбор plain/markdown, что и у Ctrl+V */
export const pasteFromClipboard = async (
  view: EditorView,
  mode: PasteMode
): Promise<void> => {
  const { html, plain } = await readClipboard()
  const markdown = html.trim() ? htmlToMarkdown(html) : ''
  const text = mode === 'plain' || !markdown ? plain : markdown

  if (!text) return

  insertPastedText(view, text)
  view.focus()
}

/** Вставка «как текст» — всегда `text/plain` */
export const pastePlainFromClipboard = async (
  view: EditorView
): Promise<void> => {
  const text = await navigator.clipboard.readText()

  if (!text) return

  insertPastedText(view, text)
  view.focus()
}
