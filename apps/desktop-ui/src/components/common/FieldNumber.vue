<template>
  <input
    type="number"
    :value="String(value ?? '')"
    :placeholder="placeholder"
    :min="min"
    :max="max"
    :step="step"
    class="input"
    @input="handleInput"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @wheel="handleWheel"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'

withDefaults(
  defineProps<{
    value?: string | number
    placeholder?: string
    min?: string | number
    max?: string | number
    step?: string | number
  }>(),
  { step: 1 }
)

const emit = defineEmits<{ (e: 'update:value', value: string): void }>()
const hovered = ref(false)

function handleInput(event: Event) {
  emit('update:value', (event.target as HTMLInputElement).value)
}

function handleWheel(event: WheelEvent) {
  const input = event.currentTarget as HTMLInputElement
  if (
    !hovered.value ||
    input.ownerDocument.activeElement !== input ||
    input.disabled ||
    input.readOnly ||
    event.ctrlKey ||
    event.deltaY === 0 ||
    input.step === 'any'
  ) {
    return
  }

  event.preventDefault()
  const previous = input.value
  if (event.deltaY < 0) input.stepUp()
  else input.stepDown()
  if (input.value !== previous) {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
}
</script>

<style scoped>
input {
  width: 7.5rem;
}
</style>
