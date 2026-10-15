<template>
  <input
    v-bind="controlAttrs()"
    :type="type"
    :value="String(currentValue ?? '')"
    :placeholder="placeholder"
    class="input"
    @input="handleInput"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl()

const props = withDefaults(
  defineProps<{
    value?: string | number
    modelValue?: string | number
    placeholder?: string
    type?: string
  }>(),
  { type: 'text' }
)

const emit = defineEmits<{
  (e: 'update:value', value: string): void
  (e: 'update:modelValue', value: string): void
}>()

const currentValue = computed(() =>
  props.modelValue !== undefined ? props.modelValue : props.value
)

function handleInput(event: Event) {
  const next = (event.target as HTMLInputElement).value
  emit('update:value', next)
  emit('update:modelValue', next)
}
</script>

<style scoped>
input {
  width: 100%;
}
</style>
