<template>
  <div>
    <textarea :value="inputText" @input="handleInput" />
    <Diff :oldText="props.oldText" :newText="inputText" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  oldText: string;
  newText: string;
}>();
const inputText = ref<string>(props.newText);

const emit = defineEmits<{
  (e: 'update:newText', value: string): void
}>();

function handleInput(event: Event) {
  const nextValue = (event.target as HTMLTextAreaElement).value
  inputText.value = nextValue
  emit('update:newText', nextValue)
}
</script>

<style scoped>
textarea {
  width: 100%;
  height: 150px;
}
</style>
