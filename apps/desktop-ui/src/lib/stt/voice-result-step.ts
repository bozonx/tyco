import { ref } from 'vue'

export function createVoiceResultStep() {
  const isInsertMenuVisible = ref(false)
  const dictationResultText = ref('')

  function showResult(text: string) {
    dictationResultText.value = text
    isInsertMenuVisible.value = true
  }

  function resetResult() {
    isInsertMenuVisible.value = false
    dictationResultText.value = ''
  }

  return { isInsertMenuVisible, dictationResultText, showResult, resetResult }
}
