<template>
  <textarea
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  value?: string
  placeholder?: string
  selected?: string
  autoResize?: boolean
  maxAutoHeight?: number
}>()

const emit = defineEmits<{
  (e: 'update:value', value: string): void
  (e: 'update:selected', selected: string): void
  (e: 'select', value: string, start: number, end: number): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const value = computed(() => props.value || '')

const selection = ref<string>('')

function adjustHeight() {
  if (!props.autoResize || !textareaRef.value) return
  const el = textareaRef.value
  el.style.height = 'auto'
  const maxHeight = props.maxAutoHeight ?? 200
  const targetHeight = Math.min(el.scrollHeight, maxHeight)
  el.style.height = `${targetHeight}px`
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  if (el.scrollHeight <= maxHeight) {
    el.scrollTop = 0
  }
}

function handleInput(event: Event) {
  emit('update:value', (event.target as HTMLTextAreaElement).value)
  if (props.autoResize) {
    adjustHeight()
  }
}

const handleSelect = () => {
  if (!textareaRef.value) return

  const textarea = textareaRef.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd

  if (start === end) {
    // Нет выделения
    selection.value = ''

    emit('select', '', start, end)
  } else {
    // Есть выделение
    const selectedText = textarea.value.substring(start, end)
    selection.value = selectedText

    emit('select', selection.value, start, end)
  }
}

watch(
  () => props.value,
  async () => {
    if (props.autoResize) {
      await nextTick()
      adjustHeight()
    }
  }
)

watch(
  () => props.maxAutoHeight,
  () => adjustHeight()
)

onMounted(async () => {
  if (props.autoResize) {
    await nextTick()
    adjustHeight()
  }
})

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

textarea.is-auto-resize {
  min-height: 0 !important;
  resize: none;
  overflow-y: hidden;
  box-sizing: border-box;
}
</style>
