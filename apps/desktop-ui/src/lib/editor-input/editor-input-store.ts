import { computed, ref } from 'vue'

import type { EditSource } from '../editor/edit-source'

export function createEditorInputStoreModel() {
  const value = ref<string>('')
  const focusCount = ref<number>(0)
  const selectAllCount = ref<number>(0)
  const selectedText = ref<string>('')
  const selectionStart = ref<number>(0)
  const selectionEnd = ref<number>(0)
  const lastEditSource = ref<EditSource>('plain')

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

  /**
   * Puts the result of a transformation of `sourceText` into the editor. When
   * the source is the current selection (the action was started on it), only
   * the selection is replaced and its surrounding whitespace is kept; otherwise
   * the source came from elsewhere and the result replaces the whole document
   */
  const applyResult = (
    result: string,
    sourceText: string,
    source: EditSource = 'ai'
  ): void => {
    const selected = selectedText.value
    const trimmedSource = sourceText.trim()

    if (!selected.trim() || selected.trim() !== trimmedSource) {
      setValue(result, source)
      setSelection('', 0, 0)
      return
    }

    const leading = selected.match(/^\s*/)?.[0] ?? ''
    const trailing = selected.match(/\s*$/)?.[0] ?? ''

    replaceSelection(leading + result.trim() + trailing, source)
  }

  const clear = (): void => {
    lastEditSource.value = 'clear'
    value.value = ''
    // the editor does not echo store edits back, so the old selection would
    // survive an empty document and leak into the next AI action
    setSelection('', 0, 0)
  }

  const focus = (): void => {
    focusCount.value++
  }

  const selectAll = (): void => {
    selectAllCount.value++
  }

  const setSelection = (text: string, start: number, end: number): void => {
    selectedText.value = text
    selectionStart.value = start
    selectionEnd.value = end
  }

  return {
    value,
    focusCount,
    selectAllCount,
    selectedText,
    selectionStart,
    selectionEnd,
    lastEditSource,
    hasSelection,
    actionText,
    setValue,
    replaceValue,
    focus,
    selectAll,
    setSelection,
    replaceSelection,
    applyResult,
    clear,
  }
}
