<template>
  <FieldPromptTextArea v-bind="$attrs" ref="promptTextAreaRef" />
</template>

<script setup lang="ts">
import { ref } from 'vue'

import FieldPromptTextArea from './FieldPromptTextArea.vue'

defineOptions({ inheritAttrs: false })

const promptTextAreaRef = ref<InstanceType<typeof FieldPromptTextArea> | null>(
  null
)

defineExpose({
  focus: () => promptTextAreaRef.value?.focus(),
  isFocused: () => promptTextAreaRef.value?.isFocused?.() ?? false,
  getSelection: () => promptTextAreaRef.value?.getSelection?.() ?? null,
  select: (start?: number, end?: number) =>
    promptTextAreaRef.value?.select?.(start, end),
})
</script>
