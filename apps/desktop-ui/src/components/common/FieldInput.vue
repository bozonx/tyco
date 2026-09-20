<template>
  <input
    type="text"
    :value="String(value ?? '')"
    :placeholder="placeholder"
    class="input"
    @input="handleInput"
  />
</template>

<script setup lang="ts">
defineProps<{ value?: string | number; placeholder?: string }>()

const emit = defineEmits<{ (e: 'update:value', value: string): void }>()

function handleInput(event: Event) {
  emit('update:value', (event.target as HTMLInputElement).value)
}
</script>

<style scoped>
input {
  width: 100%;
}
</style>
