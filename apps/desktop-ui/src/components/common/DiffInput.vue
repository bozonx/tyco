<template>
  <div class="diff-input">
    <textarea
      class="textarea diff-input-text"
      :value="inputText"
      @input="handleInput"
    />
    <Diff
      :oldText="props.oldText"
      :newText="inputText"
      class="diff-input-diff"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ oldText: string; newText: string }>()
const inputText = ref<string>(props.newText)

const emit = defineEmits<{ (e: 'update:newText', value: string): void }>()

function handleInput(event: Event) {
  const nextValue = (event.target as HTMLTextAreaElement).value
  inputText.value = nextValue
  emit('update:newText', nextValue)
}
</script>

<style scoped>
.diff-input {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  height: 100%;
  min-height: 0;
}

.diff-input-text {
  flex: 1 1 50%;
  width: 100%;
  max-width: none;
  min-height: 5rem;
  font-size: 0.9375rem;
  line-height: 1.6;
  resize: none;
}

.diff-input-diff {
  flex: 1 1 50%;
  min-height: 3rem;
  overflow-y: auto;
}
</style>
