import type { EditorState, Extension } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export interface WordRange {
  from: number
  to: number
  text: string
}

export interface MenuAnchor {
  x: number
  y: number
}

export interface ContextMenuRequest extends MenuAnchor {
  /** Смещение в документе под курсором */
  pos: number
  /** Слово под курсором, если курсор стоит на слове */
  word: WordRange | null
  /** Текст выделения на момент вызова меню */
  selectedText: string
}

export interface BubbleMenuRequest extends MenuAnchor {
  selectedText: string
  from: number
  to: number
}

/**
 * Слово под смещением. Берём штатный `state.wordAt` — он опирается на
 * локаль-независимую категоризацию символов CodeMirror, поэтому кириллица
 * и латиница обрабатываются одинаково
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

/** Заменить диапазон (например, слово с ошибкой на вариант исправления) */
export const replaceRange = (
  view: EditorView,
  from: number,
  to: number,
  insert: string
): void => {
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length),
    scrollIntoView: true,
  })

  view.focus()
}

export interface EditorMenusOptions {
  /** ПКМ по редактору */
  onContextMenu?: (request: ContextMenuRequest) => void
  /**
   * Выделение стало непустым — можно показать bubble-меню. Вызывается с `null`,
   * когда выделение снято
   */
  onSelectionMenu?: (request: BubbleMenuRequest | null) => void
}

/**
 * Координаты начала выделения на экране — точка привязки bubble-меню.
 *
 * Если позицию измерить не удалось (документ ещё не отрисован), падаем на угол
 * редактора — меню должно открыться в любом случае
 */
export const anchorAtPos = (view: EditorView, pos: number): MenuAnchor => {
  try {
    const coords = view.coordsAtPos(pos)

    if (coords) return { x: coords.left, y: coords.top }
  } catch {
    // нет измеримой геометрии
  }

  const rect = view.dom.getBoundingClientRect()

  return { x: rect.left, y: rect.top }
}

/** Смещение в документе под точкой экрана; null — измерить не удалось */
const posAtPoint = (view: EditorView, x: number, y: number): number | null => {
  try {
    return view.posAtCoords({ x, y })
  } catch {
    return null
  }
}

/**
 * Контекстное меню по ПКМ и bubble-меню над выделением.
 *
 * Нативное меню отключаем всегда: в webview Tauri оно всё равно бесполезно, а
 * варианты исправлений приходят из собственного словаря
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
        pos,
        word: wordAt(view.state, pos),
        selectedText: from === to ? '' : view.state.sliceDoc(from, to),
      })

      return true
    },
  }),
  EditorView.updateListener.of((update) => {
    if (!options.onSelectionMenu) return
    if (!update.selectionSet && !update.docChanged) return

    const { from, to } = update.state.selection.main

    if (from === to) {
      options.onSelectionMenu(null)

      return
    }

    options.onSelectionMenu({
      ...anchorAtPos(update.view, from),
      from,
      to,
      selectedText: update.state.sliceDoc(from, to),
    })
  }),
]
