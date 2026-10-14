<template>
  <input
    v-bind="controlAttrs()"
    type="number"
    :value="String(value ?? '')"
    :placeholder="placeholder"
    :min="min"
    :max="max"
    :step="step"
    class="input"
    @input="handleInput"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @wheel="handleWheel"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl()

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

const emit = defineEmits<{
  (e: 'update:value', value: string): void
  (e: 'invalid-input'): void
}>()
const isHovered = ref(false)

function handleInput(event: Event) {
  const input = event.target as HTMLInputElement
  // Browsers report an empty value for unfinished numeric input such as '-'.
  // It must not be treated as the user's request to clear a setting.
  if (input.validity.badInput) {
    emit('invalid-input')
    return
  }
  emit('update:value', input.value)
}

function handleWheel(event: WheelEvent) {
  const input = event.currentTarget as HTMLInputElement
  if (
    !isHovered.value ||
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
