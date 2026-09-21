import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useChatInputStore = defineStore('chatInput', () => {
  const value = ref<string>('')
  const focusCount = ref<number>(0)

  // replace value
  const setValue = (newText: string): void => {
    value.value = newText
  }

  const clear = (): void => {
    value.value = ''
  }

  const focus = (): void => {
    focusCount.value++
  }

  return { value, focusCount, setValue, focus, clear }
})
