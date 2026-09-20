import { isolateHistory } from '@codemirror/commands'
import { EditorSelection, Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { placeholder } from '@codemirror/view'

import { fromStore, placeholderCompartment } from './createEditorState'
import type { EditSource } from './editSource'
import { EDIT_USER_EVENT, isolatedEditSources } from './editSource'

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

export interface StoreEdit {
  /** Новое содержимое документа */
  value: string
  /** Выделение после правки; не задано — оставляем как есть */
  selectionStart?: number
  selectionEnd?: number
  /** Источник правки, по умолчанию обычная замена значения */
  source?: EditSource
}

const clamp = (value: number, length: number): number =>
  Math.max(0, Math.min(value, length))

/**
 * Единственная точка, через которую правки стора попадают в редактор.
 *
 * Текст и выделение применяются одной транзакцией — иначе AI-преобразование
 * разъехалось бы на два шага Ctrl+Z. Правки от AI и распознавания речи
 * изолируются в истории, чтобы не склеиваться с ручным вводом
 *
 * @returns True, если транзакция была отправлена
 */
export const applyStoreEdit = (view: EditorView, edit: StoreEdit): boolean => {
  const source = edit.source ?? 'plain'
  const change = computeMinimalChange(view.state.doc.toString(), edit.value)
  const nextLength = edit.value.length
  const current = view.state.selection.main

  const wantsSelection =
    edit.selectionStart !== undefined && edit.selectionEnd !== undefined
  const from = wantsSelection ? clamp(edit.selectionStart!, nextLength) : 0
  const to = wantsSelection ? clamp(edit.selectionEnd!, nextLength) : 0
  const selectionChanged =
    wantsSelection &&
    (current.from !== Math.min(from, to) || current.to !== Math.max(from, to))

  // при правке текста выделение всё равно пересчитывается, поэтому ставим его
  // в ту же транзакцию, даже если по старым смещениям оно совпадает
  const needSelection = wantsSelection && (selectionChanged || change !== null)

  if (!change && !needSelection) return false

  const annotations = [
    fromStore.of(true),
    Transaction.userEvent.of(EDIT_USER_EVENT[source]),
  ]

  if (isolatedEditSources.has(source)) {
    annotations.push(isolateHistory.of('full'))
  }

  view.dispatch({
    ...(change ? { changes: change } : {}),
    ...(needSelection ? { selection: EditorSelection.single(from, to) } : {}),
    annotations,
    scrollIntoView: true,
  })

  return true
}

/**
 * Применить значение стора к редактору транзакцией
 *
 * @returns True, если документ действительно изменился
 */
export const applyStoreValue = (
  view: EditorView,
  value: string,
  source: EditSource = 'plain'
): boolean => applyStoreEdit(view, { value, source })

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
): boolean =>
  applyStoreEdit(view, {
    value: view.state.doc.toString(),
    selectionStart: start,
    selectionEnd: end,
  })

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
