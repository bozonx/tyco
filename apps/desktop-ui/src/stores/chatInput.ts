import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DebounceCallIncreasing } from '@/lib/squidlet-lib-local'

import { useHistoryStore } from './history'

export const useChatInputStore = defineStore('chatInput', () => {
  const value = ref<string>('')
  const focusCount = ref<number>(0)

  const debounced = new DebounceCallIncreasing()
  const historyStore = useHistoryStore()

  // replace value
  const setValue = (newText: string): void => {
    value.value = newText

    debounced.invoke(() => {
      // TODO: может отдельное хранилище для каждого интута
      historyStore.saveMainInputTmp(newText)
    }, 600)
  }

  const clear = (): void => {
    value.value = ''

    historyStore.clearMainInputTmp()
  }

  const focus = (): void => {
    focusCount.value++
  }

  return {
    value,
    focusCount,
    setValue,
    focus,
    clear,
  }
})
