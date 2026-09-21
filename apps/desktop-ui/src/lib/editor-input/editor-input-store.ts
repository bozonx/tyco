import { ref } from 'vue'

import type { EditSource } from '../editor/edit-source'
import { createDraftSession, type SaveDraft } from '../history/draft-session'

export interface EditorInputDeps {
  /** Stores unsent text in the history, see `createDraftSession`. */
  saveDraft: SaveDraft
}

export function createEditorInputStoreModel(deps: EditorInputDeps) {
  const value = ref<string>('')
  const focusCount = ref<number>(0)
  const selectAllCount = ref<number>(0)
  const selectedText = ref<string>('')
  const selectionStart = ref<number>(0)
  const selectionEnd = ref<number>(0)
  const lastEditSource = ref<EditSource>('plain')
  const drafts = createDraftSession(deps.saveDraft)

  /**
   * The current text is about to leave the editor: it goes to the history
   * unless it is one of `keptTexts` (it lives on in the editor or was already
   * stored as the source of an AI operation)
   */
  const discardCurrent = (...keptTexts: string[]): void => {
    const current = value.value.trim()

    if (!current || keptTexts.some((text) => text.trim() === current)) return

    void drafts.end(value.value)
  }

  const setValue = (newText: string, source: EditSource = 'plain'): void => {
    lastEditSource.value = source
    value.value = newText
  }

  /** Puts a text from elsewhere into the editor instead of the current one. */
  const replaceValue = (
    newText: string,
    source: EditSource = 'plain'
  ): void => {
    discardCurrent(newText)
    setValue(newText, source)
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
      discardCurrent(sourceText, result)
      setValue(result, source)
      return
    }

    const leading = selected.match(/^\s*/)?.[0] ?? ''
    const trailing = selected.match(/\s*$/)?.[0] ?? ''

    replaceSelection(leading + result.trim() + trailing, source)
  }

  const clear = (): void => {
    discardCurrent()
    lastEditSource.value = 'plain'
    value.value = ''
    // the editor does not echo store edits back, so the old selection would
    // survive an empty document and leak into the next AI action
    setSelection('', 0, 0)
  }

  /** The window is hidden: the text survives that, but not a quit. */
  const snapshotDraft = (): Promise<void> => drafts.snapshot(value.value)

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
    replaceValue,
    snapshotDraft,
    focus,
    selectAll,
    setSelection,
    replaceSelection,
    applyResult,
    clear,
  }
}
