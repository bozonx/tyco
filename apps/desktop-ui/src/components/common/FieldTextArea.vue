<template>
  <textarea
    class="textarea"
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

const props = defineProps<{
  value?: string
  placeholder?: string
  selected?: string
}>()

const emit = defineEmits<{
  (e: 'update:value', value: string): void
  (e: 'update:selected', selected: string): void
  (e: 'select', value: string, start: number, end: number): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const value = computed(() => props.value || '')

const selected = ref<string>('')

function handleInput(event: Event) {
  emit('update:value', (event.target as HTMLTextAreaElement).value)
}

const handleSelect = () => {
  if (!textareaRef.value) return

  const textarea = textareaRef.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd

  if (start === end) {
    // Нет выделения
    selected.value = ''

    emit('select', '', start, end)
  } else {
    // Есть выделение
    const selectedText = textarea.value.substring(start, end)
    selected.value = selectedText

    emit('select', selected.value, start, end)
  }
}

// Экспортируем функцию focus для внешнего использования
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
</style>
