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

import { useI18n } from '../../composables/use-i18n'
import { useTextareaAutosize } from '../../composables/use-textarea-autosize'
import {
  resolveInputKeyAction,
  resolveSubmitKey,
} from '../../lib/input-keys/input-keys'
import { useChatStore } from '../../stores/chat'
import { useChatInputStore } from '../../stores/chat-input'
import { useIpcStore } from '../../stores/ipc'

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

const { resize } = useTextareaAutosize(
  textareaRef,
  () => chatInputStore.value,
  () => ({ enabled: true, maxHeight: 192 })
)

onMounted(async () => {
  await nextTick()
  chatInputStore.requestFocus()
  resize()
})

watch(
  () => chatInputStore.focusRequestCount,
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

/**
 * Office apps put a picture of copied text next to the text itself: a paste
 * with text stays a text paste, and only a clipboard without text attaches its
 * files
 */
function handlePaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files || [])
  if (!files.length || event.clipboardData?.getData('text/plain')) return
  event.preventDefault()
  void chatStore.addFiles(files)
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
  const submitKey = resolveSubmitKey(
    ipcStore.desktopState?.userConfig?.submitKey
  )
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
