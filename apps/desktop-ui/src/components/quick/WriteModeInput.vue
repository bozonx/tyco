<template>
  <FieldTextArea
    ref="textareaRef"
    class="main-input"
    auto-resize
    :max-auto-height="maxHeight"
    :placeholder="t('input.textPlaceholder')"
    :value="quickInputStore.value"
    @update:value="handleInput"
  />
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useQuickInputStore } from '../../stores/quick-input'

withDefaults(defineProps<{ maxHeight?: number }>(), { maxHeight: 200 })

const quickInputStore = useQuickInputStore()
const menuModalsStore = useMenuModalsStore()
// FieldTextArea exposes these
const textareaRef = ref<{ focus: () => void; select: () => void } | null>(null)
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
</script>

<style scoped>
.main-input {
  width: 100%;
  resize: none;
}
</style>
