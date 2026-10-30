import type { EditorInputSnapshot } from '@tyco/plugin-sdk'
import { computed, ref, watch } from 'vue'

import type { EditSource } from '../editor/edit-source'

export function createEditorInputModel() {
  const value = ref<string>('')
  const focusRequestCount = ref<number>(0)
  const selectAllRequestCount = ref<number>(0)
  const searchRequestCount = ref<number>(0)
  const selectedText = ref<string>('')
  const selectionStart = ref<number>(0)
  const selectionEnd = ref<number>(0)
  const lastEditSource = ref<EditSource>('plain')
  let revision = 0
  const resultSources = new Map<string, EditorInputSnapshot>()
  // Track intermediate edits too, including changes that are later undone.
  watch([value, selectedText, selectionStart, selectionEnd], () => revision++, {
    flush: 'sync',
  })
  const getSnapshot = (): EditorInputSnapshot => ({
    value: value.value,
    selectedText: selectedText.value,
    selectionStart: selectionStart.value,
    selectionEnd: selectionEnd.value,
    revision,
  })
  const isSnapshotCurrent = (snapshot: EditorInputSnapshot): boolean =>
    snapshot.revision === revision &&
    snapshot.value === value.value &&
    snapshot.selectedText === selectedText.value &&
    snapshot.selectionStart === selectionStart.value &&
    snapshot.selectionEnd === selectionEnd.value

  /** Remember the exact source before opening an editor action's result flow. */
  const captureResultSource = (sourceText: string): void => {
    if (resultSources.size >= 16)
      resultSources.delete(resultSources.keys().next().value!)
    resultSources.set(sourceText.trim(), getSnapshot())
  }

  /** A selection of whitespace only does not count: actions take the whole text */
  const hasSelection = computed(() => selectedText.value.trim() !== '')

  /**
   * The text an editor action works on: the selection when there is one,
   * otherwise the whole document
   */
  const actionText = (): string =>
    hasSelection.value ? selectedText.value : value.value

  const setValue = (newText: string, source: EditSource = 'plain'): void => {
    lastEditSource.value = source
    value.value = newText
  }

  /** Puts a text from elsewhere into the editor instead of the current one. */
  const replaceValue = (
    newText: string,
    source: EditSource = 'plain'
  ): void => {
    setValue(newText, source)
    setSelection('', 0, 0)
  }

  const replaceSelection = (
    newText: string,
    source: EditSource = 'ai'
  ): void => {
    const beforeSelection = value.value.substring(0, selectionStart.value)
    const afterSelection = value.value.substring(selectionEnd.value)
    const newValue = beforeSelection + newText + afterSelection

    lastEditSource.value = source
    value.value = newValue

    const newEnd = selectionStart.value + newText.length
    setSelection(newText, selectionStart.value, newEnd)
  }

  const applySnapshotEdit = (
    snapshot: EditorInputSnapshot,
    text: string,
    scope: 'selection' | 'document',
    source: EditSource = 'ai'
  ): boolean => {
    if (!isSnapshotCurrent(snapshot)) return false
    if (scope === 'selection') {
      replaceSelection(text, source)
      return true
    }
    // a reformatted document keeps the caret about where it was
    const caret = Math.min(selectionStart.value, text.length)
    setValue(text, source)
    setSelection('', caret, caret)
    return true
  }

  /**
   * Puts the result of a transformation of `sourceText` into the editor. When
   * the source is the current selection (the action was started on it), only
   * the selection is replaced and its surrounding whitespace is kept. Whole
   * document results require a matching source or an empty destination.
   * Conflicts leave the editor untouched and the result available for review.
   */
  const applyResult = (
    result: string,
    sourceText: string,
    source: EditSource = 'ai'
  ): boolean => {
    const selected = selectedText.value
    const trimmedSource = sourceText.trim()
    const snapshot = resultSources.get(trimmedSource)
    if (snapshot && !isSnapshotCurrent(snapshot)) return false

    if (!selected.trim() || selected.trim() !== trimmedSource) {
      if (value.value.trim() && value.value.trim() !== trimmedSource)
        return false
      replaceValue(result, source)
      resultSources.delete(trimmedSource)
      return true
    }

    const leading = selected.match(/^\s*/)?.[0] ?? ''
    const trailing = selected.match(/\s*$/)?.[0] ?? ''

    replaceSelection(leading + result.trim() + trailing, source)
    resultSources.delete(trimmedSource)
    return true
  }

  const clear = (): void => {
    lastEditSource.value = 'clear'
    value.value = ''
    // the editor does not echo store edits back, so the old selection would
    // survive an empty document and leak into the next AI action
    setSelection('', 0, 0)
  }

  const requestFocus = (): void => {
    focusRequestCount.value++
  }

  const requestSelectAll = (): void => {
    selectAllRequestCount.value++
  }

  const requestSearch = (): void => {
    searchRequestCount.value++
  }

  const setSelection = (text: string, start: number, end: number): void => {
    selectedText.value = text
    selectionStart.value = start
    selectionEnd.value = end
  }

  return {
    value,
    focusRequestCount,
    selectAllRequestCount,
    searchRequestCount,
    selectedText,
    selectionStart,
    selectionEnd,
    lastEditSource,
    hasSelection,
    actionText,
    setValue,
    replaceValue,
    requestFocus,
    requestSelectAll,
    setSelection,
    replaceSelection,
    applyResult,
    getSnapshot,
    applySnapshotEdit,
    captureResultSource,
    requestSearch,
    clear,
  }
}
