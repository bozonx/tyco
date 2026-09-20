import { Transaction } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { PasteMode } from '@tyco/shared'

import { anchorAtPos } from './context-menu'
import { EDIT_USER_EVENT } from './edit-source'
import { htmlToMarkdown } from './html-to-markdown'

/**
 * Сколько миллисекунд после Ctrl+Shift+V считаем следующую вставку «только
 * текст». Прочитать буфер обмена прямо в обработчике клавиши нельзя, поэтому
 * помечаем намерение и ждём нативное событие `paste`
 */
const PLAIN_PASTE_WINDOW_MS = 500

export interface PasteAskRequest {
  /** Координаты каретки на экране — там откроется меню выбора */
  x: number
  y: number
  /** Что вставится в режиме «как текст» */
  plain: string
  /** Что вставится в режиме «с форматированием» */
  markdown: string
  /** Вставить выбранный вариант */
  apply: (text: string) => void
}

export interface PasteOptions {
  /** Режим вставки из пользовательских настроек */
  getMode: () => PasteMode
  /**
   * Спросить у пользователя, как вставлять. Не задан — ведём себя как
   * `markdown`
   */
  onAsk?: (request: PasteAskRequest) => void
}

/** Вставить текст в текущее выделение как обычную вставку */
export const insertPastedText = (view: EditorView, text: string): void => {
  view.dispatch({
    ...view.state.replaceSelection(text),
    annotations: Transaction.userEvent.of(EDIT_USER_EVENT.paste),
    scrollIntoView: true,
  })
}

/**
 * Обработка вставки: если в буфере есть `text/html`, превращаем его в Markdown,
 * иначе вставляем `text/plain` как есть. Ctrl+Shift+V всегда вставляет текстом
 */
export const pasteExtension = (options: PasteOptions): Extension => {
  let plainPasteRequestedAt = 0

  const consumePlainRequest = (): boolean => {
    if (Date.now() - plainPasteRequestedAt > PLAIN_PASTE_WINDOW_MS) return false

    plainPasteRequestedAt = 0

    return true
  }

  return [
    keymap.of([
      {
        key: 'Mod-Shift-v',
        run: () => {
          plainPasteRequestedAt = Date.now()

          // не перехватываем: нативная вставка всё равно должна произойти,
          // обработчик ниже увидит отметку и вставит plain text
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

        // без HTML конвертировать нечего — пусть CodeMirror отработает
        // вставку сам
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
          const { x, y } = anchorAtPos(view, view.state.selection.main.head)

          options.onAsk({
            x,
            y,
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
