<template>
  <FieldTextArea
    ref="textareaRef"
    class="main-input"
    :placeholder="t('input.textPlaceholder')"
    :value="chatInputStore.value"
    @update:value="handleInput"
  />
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import { useChatInputStore } from '../stores/chatInput'

const chatInputStore = useChatInputStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const { t } = useI18n()

// set focus
onMounted(async () => {
  await nextTick()
  chatInputStore.focus()
})

// set focus on close modal
// watch(
//   () => menuModalsStore.anyModalOpen,
//   (value) => {
//     if (!value) chatInputStore.focus()
//   }
// )

// handle focus
watch(
  () => chatInputStore.focusCount,
  (newValue, oldValue) => {
    if (newValue > oldValue) {
      textareaRef.value?.focus()
    }
  }
)

const handleInput = (value: string): void => {
  chatInputStore.setValue(value)
}
</script>

<style scoped>
.main-input {
  height: 100%;
  resize: none;
}
</style>
