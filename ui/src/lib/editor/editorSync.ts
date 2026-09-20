import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { placeholder } from '@codemirror/view'

import { fromStore, placeholderCompartment } from './createEditorState'

export interface DocChange {
  from: number
  to: number
  insert: string
}

/**
 * Минимальная правка, превращающая `oldText` в `newText`: отрезаем общий
 * префикс и общий суффикс. Нужна, чтобы программная замена текста не
 * переписывала документ целиком — иначе рушится история undo и прыгает каретка
 *
 * @returns Null, если тексты совпадают
 */
export const computeMinimalChange = (
  oldText: string,
  newText: string
): DocChange | null => {
  if (oldText === newText) return null

  const maxPrefix = Math.min(oldText.length, newText.length)
  let prefix = 0

  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++

  const maxSuffix = maxPrefix - prefix
  let suffix = 0

  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] ===
      newText[newText.length - 1 - suffix]
  )
    suffix++

  return {
    from: prefix,
    to: oldText.length - suffix,
    insert: newText.slice(prefix, newText.length - suffix),
  }
}

/**
 * Применить значение стора к редактору транзакцией
 *
 * @returns True, если документ действительно изменился
 */
export const applyStoreValue = (view: EditorView, value: string): boolean => {
  const change = computeMinimalChange(view.state.doc.toString(), value)

  if (!change) return false

  view.dispatch({ changes: change, annotations: fromStore.of(true) })

  return true
}

/**
 * Применить выделение стора к редактору. Смещения подрезаются по длине
 * документа — стор может отстать от редактора на одну правку
 *
 * @returns True, если выделение действительно изменилось
 */
export const applyStoreSelection = (
  view: EditorView,
  start: number,
  end: number
): boolean => {
  const length = view.state.doc.length
  const from = Math.max(0, Math.min(start, length))
  const to = Math.max(0, Math.min(end, length))
  const current = view.state.selection.main

  if (
    current.from === Math.min(from, to) &&
    current.to === Math.max(from, to)
  ) {
    return false
  }

  view.dispatch({
    selection: EditorSelection.single(from, to),
    annotations: fromStore.of(true),
  })

  return true
}

/** Выделить весь документ */
export const selectAll = (view: EditorView): void => {
  view.dispatch({
    selection: EditorSelection.single(0, view.state.doc.length),
    scrollIntoView: true,
  })
}

/** Сменить текст плейсхолдера (например, при смене языка) */
export const setPlaceholder = (view: EditorView, text: string): void => {
  view.dispatch({
    effects: placeholderCompartment.reconfigure(placeholder(text)),
    annotations: fromStore.of(true),
  })
}
