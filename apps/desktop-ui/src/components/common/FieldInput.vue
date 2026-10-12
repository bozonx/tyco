<template>
  <input
    v-bind="controlAttrs()"
    :type="type"
    :value="String(value ?? '')"
    :placeholder="placeholder"
    class="input"
    @input="handleInput"
  />
</template>

<script setup lang="ts">
import { useFieldControl } from '../../composables/use-field-control'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl()

withDefaults(
  defineProps<{
    value?: string | number
    placeholder?: string
    type?: string
  }>(),
  { type: 'text' }
)

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
