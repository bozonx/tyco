<template>
  <FieldTextArea
    ref="textareaRef"
    class="main-input"
    appearance="plain"
    auto-resize
    :max-auto-height="maxHeight"
    :placeholder="t('input.textPlaceholder')"
    :aria-label="t('input.textPlaceholder')"
    :model-value="quickInputStore.value"
    @update:model-value="handleInput"
  />
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { TextControl } from '../../lib/ui/text-control'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useQuickInputStore } from '../../stores/quick-input'
import FieldTextArea from '../common/FieldTextArea.vue'

withDefaults(defineProps<{ maxHeight?: number }>(), { maxHeight: 200 })

const quickInputStore = useQuickInputStore()
const menuModalsStore = useMenuModalsStore()
// FieldTextArea exposes these
const textareaRef = ref<TextControl | null>(null)
const { t } = useI18n()

// set value from route params and focus
onMounted(async () => {
  await nextTick()
  quickInputStore.requestFocus()
})

// set focus on close modal
watch(
  () => menuModalsStore.hasOpenModal,
  (value) => {
    if (!value) quickInputStore.requestFocus()
  }
)

// handle focus
watch(
  () => quickInputStore.focusRequestCount,
  (newValue, oldValue) => {
    if (newValue > oldValue) {
      textareaRef.value?.focus()
    }
  }
)

watch(
  () => quickInputStore.selectAllRequestCount,
  async (newValue, oldValue) => {
    if (newValue <= oldValue) return
    await nextTick()
    textareaRef.value?.focus()
    textareaRef.value?.select()
  }
)

const handleInput = (value: string): void => {
  quickInputStore.setValue(value)
}
defineExpose({
  focus: () => textareaRef.value?.focus(),
  isFocused: () => textareaRef.value?.isFocused() ?? false,
  getSelection: () => textareaRef.value?.getSelection() ?? null,
  select: (start?: number, end?: number) =>
    textareaRef.value?.select(start, end),
} satisfies TextControl)
</script>

<style scoped>
.main-input {
  width: 100%;
  min-height: 0 !important;
  height: auto;
  padding: var(--space-sm) var(--space-md);
  resize: none;
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
}

/* The write frame around the field shows the focus */
.main-input:focus {
  outline: none;
}
</style>
