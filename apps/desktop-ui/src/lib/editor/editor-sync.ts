import { isolateHistory } from '@codemirror/commands'
import { EditorSelection, Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { placeholder } from '@codemirror/view'

import { fromStore, placeholderCompartment } from './create-editor-state'
import type { EditSource } from './edit-source'
import { EDIT_USER_EVENT, isolatedEditSources } from './edit-source'

export interface DocChange {
  from: number
  to: number
  insert: string
}

/**
 * Minimal change transforming `oldText` into `newText` by stripping common
 * prefix and suffix. Prevents programmatic text replacements from rewriting the
 * entire document, which would break undo history and cursor position.
 *
 * @returns Null if texts match
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
  /** New document content */
  value: string
  /** Selection after edit; left unchanged if undefined */
  selectionStart?: number
  selectionEnd?: number
  /** Edit source, defaults to plain value replacement */
  source?: EditSource
}

const clamp = (value: number, length: number): number =>
  Math.max(0, Math.min(value, length))

/**
 * The single entry point through which store edits reach the editor.
 *
 * Text and selection are applied in one transaction — otherwise an AI
 * transformation would split into two Ctrl+Z steps. Edits from AI and speech
 * recognition are isolated in history to avoid merging with manual typing.
 *
 * @returns True if transaction was dispatched
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

  // When text changes, selection is recalculated anyway, so include it
  // in the same transaction even if old offsets match.
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
 * Applies store value to editor via transaction.
 *
 * @returns True if document actually changed
 */
export const applyStoreValue = (
  view: EditorView,
  value: string,
  source: EditSource = 'plain'
): boolean => applyStoreEdit(view, { value, source })

/**
 * Applies store selection to editor. Offsets are clamped to document length in
 * case the store is one edit behind the editor.
 *
 * @returns True if selection actually changed
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

/** Select entire document */
export const selectAll = (view: EditorView): void => {
  view.dispatch({
    selection: EditorSelection.single(0, view.state.doc.length),
    scrollIntoView: true,
  })
}

/** Change placeholder text (e.g. on language change) */
export const setPlaceholder = (view: EditorView, text: string): void => {
  view.dispatch({
    effects: placeholderCompartment.reconfigure(placeholder(text)),
    annotations: fromStore.of(true),
  })
}

/** Replace a range in document — entry point for spellcheck and insertions */
export const replaceRange = (
  view: EditorView,
  from: number,
  to: number,
  insert: string
): void => {
  view.dispatch({ changes: { from, to, insert }, scrollIntoView: true })
}
