import { ref } from 'vue'

import type { EditSource } from '../editor/edit-source'

export interface EditorInputHistoryApi {
  saveMainInputTmp: (value: string) => Promise<void> | void
  clearMainInputTmp: () => Promise<void> | void
}

export interface DebounceInvoker {
  invoke: (callback: () => void, delayMs: number) => void
}

export function createEditorInputStoreModel(
  historyApi: EditorInputHistoryApi,
  debounced?: DebounceInvoker
) {
  const value = ref<string>('')
  const focusCount = ref<number>(0)
  const selectAllCount = ref<number>(0)
  const selectedText = ref<string>('')
  const selectionStart = ref<number>(0)
  const selectionEnd = ref<number>(0)
  const lastEditSource = ref<EditSource>('plain')

  const scheduleSave = (newText: string) => {
    if (debounced) {
      debounced.invoke(() => {
        void historyApi.saveMainInputTmp(newText)
      }, 600)
    } else {
      void historyApi.saveMainInputTmp(newText)
    }
  }

  const setValue = (newText: string, source: EditSource = 'plain'): void => {
    lastEditSource.value = source
    value.value = newText
    scheduleSave(newText)
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

    void historyApi.saveMainInputTmp(newValue)
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
      return
    }

    const leading = selected.match(/^\s*/)?.[0] ?? ''
    const trailing = selected.match(/\s*$/)?.[0] ?? ''

    replaceSelection(leading + result.trim() + trailing, source)
  }

  const clear = (): void => {
    lastEditSource.value = 'plain'
    value.value = ''
    // the editor does not echo store edits back, so the old selection would
    // survive an empty document and leak into the next AI action
    setSelection('', 0, 0)
    void historyApi.clearMainInputTmp()
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
    setValue,
    focus,
    selectAll,
    setSelection,
    replaceSelection,
    applyResult,
    clear,
  }
}
