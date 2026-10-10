<template>
  <textarea
    ref="textareaRef"
    class="main-input"
    rows="1"
    :placeholder="placeholder"
    :value="chatInputStore.value"
    @paste="handlePaste"
    @input="handleInput"
    @keydown="handleKeydown"
    @blur="handleBlur"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import {
  resolveInputKeyAction,
  resolveSubmitKey,
} from '../lib/input-keys/input-keys'
import { useChatStore } from '../stores/chat'
import { useChatInputStore } from '../stores/chatInput'
import { useIpcStore } from '../stores/ipc'

const emit = defineEmits<{ (e: 'send'): void }>()
const chatInputStore = useChatInputStore()
const ipcStore = useIpcStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const { t } = useI18n()
const chatStore = useChatStore()
/** Tells that the question will be about the attached text */
const placeholder = computed(() =>
  chatStore.attachedContext.length > 0
    ? t('chat.placeholderWithContext')
    : t('input.textPlaceholder')
)

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

function handlePaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files || [])
  if (!files.length) return
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain')
  const textarea = textareaRef.value
  if (text && textarea) {
    textarea.setRangeText(
      text,
      textarea.selectionStart,
      textarea.selectionEnd,
      'end'
    )
    chatInputStore.setValue(textarea.value)
    resize()
  }
  void chatStore.addImages(files)
}

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
  const submitKey = resolveSubmitKey(ipcStore.params?.userConfig?.submitKey)
  // a line break is left to the textarea itself
  if (resolveInputKeyAction(event, submitKey) === 'submit') {
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
