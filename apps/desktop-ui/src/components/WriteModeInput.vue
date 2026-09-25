<template>
  <FieldTextArea
    ref="textareaRef"
    class="main-input"
    auto-resize
    :max-auto-height="380"
    :placeholder="t('input.textPlaceholder')"
    :value="writerInputStore.value"
    @update:value="handleInput"
  />
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import { useMenuModalsStore } from '../stores/menuModals'
import { useWriterInputStore } from '../stores/writerInput'

const writerInputStore = useWriterInputStore()
const menuModalsStore = useMenuModalsStore()
// FieldTextArea exposes these
const textareaRef = ref<{ focus: () => void; select: () => void } | null>(null)
const { t } = useI18n()

// set value from route params and focus
onMounted(async () => {
  await nextTick()
  writerInputStore.focus()
})

// set focus on close modal
watch(
  () => menuModalsStore.anyModalOpen,
  (value) => {
    if (!value) writerInputStore.focus()
  }
)

// handle focus
watch(
  () => writerInputStore.focusCount,
  (newValue, oldValue) => {
    if (newValue > oldValue) {
      textareaRef.value?.focus()
    }
  }
)

watch(
  () => writerInputStore.selectAllCount,
  async (newValue, oldValue) => {
    if (newValue <= oldValue) return
    await nextTick()
    textareaRef.value?.focus()
    textareaRef.value?.select()
  }
)

const handleInput = (value: string): void => {
  writerInputStore.setValue(value)
}
</script>

<style scoped>
.main-input {
  width: 100%;
  resize: none;
}
</style>
