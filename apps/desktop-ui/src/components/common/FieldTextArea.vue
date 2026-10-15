<template>
  <textarea
    v-bind="controlAttrs()"
    :data-size="size ?? 'md'"
    class="textarea"
    :class="{ 'is-auto-resize': autoResize }"
    :rows="autoResize ? 1 : undefined"
    :placeholder="placeholder"
    :value="value"
    @input="handleInput"
    @select="handleSelect"
    @mouseup="handleSelect"
    @keyup="handleSelect"
    ref="textareaRef"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'
import { useTextareaAutosize } from '../../composables/use-textarea-autosize'
import type { ControlSize } from '../../lib/ui/control-types'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl()

const props = defineProps<{
  size?: ControlSize
  modelValue?: string
  placeholder?: string
  autoResize?: boolean
  maxAutoHeight?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'select', value: string, start: number, end: number): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const value = computed(() => props.modelValue || '')

const { resize: adjustHeight } = useTextareaAutosize(
  textareaRef,
  () => value.value,
  () => ({
    enabled: Boolean(props.autoResize),
    maxHeight: props.maxAutoHeight ?? 200,
  })
)

function handleInput(event: Event) {
  const next = (event.target as HTMLTextAreaElement).value

  emit('update:modelValue', next)
  if (props.autoResize) {
    adjustHeight()
  }
}

const handleSelect = () => {
  if (!textareaRef.value) return

  const textarea = textareaRef.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd

  emit('select', textarea.value.substring(start, end), start, end)
}

// Expose focus and selection for input adapters.
defineExpose({
  focus: () => textareaRef.value?.focus(),
  select: (start?: number, end?: number) => {
    if (typeof start === 'undefined' && typeof end === 'undefined') {
      textareaRef.value?.select()
    } else {
      textareaRef.value?.setSelectionRange(start ?? 0, end ?? start ?? 0)
    }
  },
})
</script>

<style scoped>
textarea {
  width: 100%;
  min-height: 100px;
  resize: vertical;
}

textarea.is-auto-resize {
  min-height: 0 !important;
  resize: none;
  overflow-y: hidden;
  box-sizing: border-box;
}
</style>
