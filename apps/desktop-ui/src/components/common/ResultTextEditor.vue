<template>
  <div class="result-editor">
    <div
      v-if="parts?.length"
      ref="highlight"
      class="highlight"
      aria-hidden="true"
    >
      <span
        v-for="(part, index) in parts"
        :key="index"
        :class="{ added: part.added }"
        >{{ part.value }}</span
      >{{ '\n' }}
    </div>
    <FieldTextArea
      class="editor"
      appearance="plain"
      :model-value="modelValue"
      :aria-label="label"
      spellcheck="false"
      @update:model-value="emit('update:modelValue', $event)"
      @scroll="syncScroll"
      @keydown.stop
      @keyup.stop
    />
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'

import type { DiffPart } from '../../lib/diff/diff-model'
import FieldTextArea from './FieldTextArea.vue'

defineProps<{ modelValue: string; label: string; parts?: DiffPart[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()
const highlight = ref<HTMLElement | null>(null)
function syncScroll(event: Event) {
  if (!highlight.value) return
  const target = event.target as HTMLElement
  highlight.value.scrollTop = target.scrollTop
  highlight.value.scrollLeft = target.scrollLeft
}
</script>
<style scoped>
.result-editor {
  position: relative;
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
}
.highlight,
.editor {
  margin: 0;
  border: 0;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--preview-font-size);
  line-height: var(--preview-line-height);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow-y: scroll;
}
.highlight {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: transparent;
}
.editor {
  position: relative;
  background: transparent;
  resize: none;
  min-height: 0;
}
.added {
  background-color: var(--app-diff-added-bg);
}
</style>
