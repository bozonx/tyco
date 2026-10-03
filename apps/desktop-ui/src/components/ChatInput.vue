<template>
  <textarea
    ref="textareaRef"
    class="main-input"
    rows="1"
    :placeholder="t('input.textPlaceholder')"
    :value="chatInputStore.value"
    @input="handleInput"
    @keydown="handleKeydown"
    @blur="handleBlur"
  />
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import { useChatInputStore } from '../stores/chatInput'

const emit = defineEmits<{ (e: 'send'): void }>()
const chatInputStore = useChatInputStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const { t } = useI18n()

function resize() {
  const textarea = textareaRef.value
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`
}

onMounted(async () => {
  await nextTick()
  chatInputStore.focus()
  resize()
})

watch(
  () => chatInputStore.focusCount,
  (newValue, oldValue) => {
    if (newValue <= oldValue) return
    const textarea = textareaRef.value
    if (!textarea) return
    textarea.focus()
    const caret = chatInputStore.takePendingCaret()
    if (caret !== null) {
      // the value watcher has not updated the textarea yet
      void nextTick(() => textarea.setSelectionRange(caret, caret))
    }
  }
)

watch(
  () => chatInputStore.value,
  async () => {
    await nextTick()
    resize()
  }
)

function handleInput(event: Event) {
  chatInputStore.setValue((event.target as HTMLTextAreaElement).value)
  resize()
}

// a click on the voice button takes the focus away; its text goes here
function handleBlur(event: FocusEvent) {
  const textarea = event.target as HTMLTextAreaElement
  chatInputStore.rememberSelection({
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  })
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    emit('send')
  }
}
</script>

<style scoped>
.main-input {
  display: block;
  width: 100%;
  min-height: 2.5rem;
  max-height: 12rem;
  resize: none;
  overflow-y: auto;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--color-base-content);
  font: inherit;
  line-height: 1.5;
}
</style>
