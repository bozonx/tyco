<template>
  <FieldTextArea
    ref="textareaRef"
    class="main-input"
    appearance="plain"
    auto-resize
    :max-auto-height="192"
    :placeholder="placeholder"
    :aria-label="placeholder"
    :model-value="chatInputStore.value"
    @paste="handlePaste"
    @update:model-value="handleInput"
    @keydown="handleKeydown"
    @blur="handleBlur"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import { useChatScope } from '../../composables/use-chat-scope'
import { useI18n } from '../../composables/use-i18n'
import { clipboardChatFiles } from '../../lib/chat/chat-clipboard-files'
import {
  resolveInputKeyAction,
  resolveSubmitKey,
} from '../../lib/input-keys/input-keys'
import type { TextControl } from '../../lib/ui/text-control'
import { useDesktopStore } from '../../stores/desktop'
import FieldTextArea from '../common/FieldTextArea.vue'

const emit = defineEmits<{ (e: 'send'): void }>()
const { chat: chatStore, input: chatInputStore } = useChatScope()
const desktopStore = useDesktopStore()
const textareaRef = ref<TextControl | null>(null)
const { t } = useI18n()
/** Tells that the question will be about the attached text */
const placeholder = computed(() =>
  chatStore.attachedContext.length > 0
    ? t('chat.placeholderWithContext')
    : t('input.textPlaceholder')
)

onMounted(async () => {
  await nextTick()
  chatInputStore.requestFocus()
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
      void nextTick(() => textarea.select(caret, caret))
    }
  }
)

function handlePaste(event: ClipboardEvent) {
  const pasted = clipboardChatFiles(event.clipboardData)
  if (!pasted) return
  event.preventDefault()
  void (pasted.kind === 'files'
    ? chatStore.addFiles(pasted.files)
    : chatStore.addDroppedFiles(pasted.paths))
}

function handleInput(value: string) {
  chatInputStore.setValue(value)
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
  const submitKey = resolveSubmitKey(desktopStore.userConfig?.submitKey)
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
  background: transparent;
  color: var(--color-base-content);
  font: inherit;
  line-height: 1.5;
}
</style>
