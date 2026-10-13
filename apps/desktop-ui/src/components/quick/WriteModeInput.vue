<template>
  <FieldTextArea
    ref="textareaRef"
    class="main-input"
    auto-resize
    :max-auto-height="maxHeight"
    :placeholder="t('input.textPlaceholder')"
    :value="writeInputStore.value"
    @update:value="handleInput"
  />
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useWriteInputStore } from '../../stores/write-input'

withDefaults(defineProps<{ maxHeight?: number }>(), { maxHeight: 200 })

const writeInputStore = useWriteInputStore()
const menuModalsStore = useMenuModalsStore()
// FieldTextArea exposes these
const textareaRef = ref<{ focus: () => void; select: () => void } | null>(null)
const { t } = useI18n()

// set value from route params and focus
onMounted(async () => {
  await nextTick()
  writeInputStore.focus()
})

// set focus on close modal
watch(
  () => menuModalsStore.anyModalOpen,
  (value) => {
    if (!value) writeInputStore.focus()
  }
)

// handle focus
watch(
  () => writeInputStore.focusCount,
  (newValue, oldValue) => {
    if (newValue > oldValue) {
      textareaRef.value?.focus()
    }
  }
)

watch(
  () => writeInputStore.selectAllCount,
  async (newValue, oldValue) => {
    if (newValue <= oldValue) return
    await nextTick()
    textareaRef.value?.focus()
    textareaRef.value?.select()
  }
)

const handleInput = (value: string): void => {
  writeInputStore.setValue(value)
}
</script>

<style scoped>
.main-input {
  width: 100%;
  resize: none;
}
</style>
