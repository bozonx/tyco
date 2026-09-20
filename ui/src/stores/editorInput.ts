import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DebounceCallIncreasing } from '@/lib/squidlet-lib-local'

import type { EditSource } from '../lib/editor/editSource'
import { useHistoryStore } from './history'

export const useEditorInputStore = defineStore('editorInput', () => {
  const value = ref<string>('')
  const focusCount = ref<number>(0)
  const selectAllCount = ref<number>(0)
  const selectedText = ref<string>('')
  const selectionStart = ref<number>(0)
  const selectionEnd = ref<number>(0)
  /**
   * Источник последней правки. Редактор читает его, чтобы поставить
   * транзакции нужный `userEvent` и решить, отдельный ли это шаг Ctrl+Z
   */
  const lastEditSource = ref<EditSource>('plain')

  const debounced = new DebounceCallIncreasing()
  const historyStore = useHistoryStore()

  // replace value
  const setValue = (newText: string, source: EditSource = 'plain'): void => {
    lastEditSource.value = source
    value.value = newText

    debounced.invoke(() => {
      // TODO: может отдельное хранилище для каждого интута
      historyStore.saveMainInputTmp(newText)
    }, 600)
  }

  // replace only selected text
  const replaceSelection = (
    newText: string,
    source: EditSource = 'ai'
  ): void => {
    // Получаем текст до и после выделения
    const beforeSelection = value.value.substring(0, selectionStart.value)
    const afterSelection = value.value.substring(selectionEnd.value)
    // Формируем новый текст
    const newValue = beforeSelection + newText + afterSelection
    // Обновляем значение
    lastEditSource.value = source
    value.value = newValue
    // Обновляем позиции выделения
    const newEnd = selectionStart.value + newText.length
    setSelection(newText, selectionStart.value, newEnd)

    historyStore.saveMainInputTmp(newValue)
  }

  const setValueAtCursor = (
    newText: string,
    source: EditSource = 'plain'
  ): void => {
    const beforeSelection = value.value.substring(0, selectionStart.value)
    const afterSelection = value.value.substring(selectionEnd.value)
    const newValue = beforeSelection + newText + afterSelection
    const newCursorPosition = selectionStart.value + newText.length

    lastEditSource.value = source
    value.value = newValue
    setSelection('', newCursorPosition, newCursorPosition)

    historyStore.saveMainInputTmp(newValue)
  }

  const clear = (): void => {
    lastEditSource.value = 'plain'
    value.value = ''

    historyStore.clearMainInputTmp()
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
    setValueAtCursor,
    clear,
  }
})
