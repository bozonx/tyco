import { ref } from 'vue'

export function createVoiceResultStep() {
  const isInsertMenuVisible = ref(false)
  const dictationResultText = ref('')
  const dictationOldText = ref('')

  function showResult(text: string, oldText = '') {
    dictationResultText.value = text
    dictationOldText.value = oldText
    isInsertMenuVisible.value = true
  }

  function resetResult() {
    isInsertMenuVisible.value = false
    dictationResultText.value = ''
    dictationOldText.value = ''
  }

  return {
    isInsertMenuVisible,
    dictationResultText,
    dictationOldText,
    showResult,
    resetResult,
  }
}
